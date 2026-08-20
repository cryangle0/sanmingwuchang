#!/usr/bin/env node

import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DELIVERY_ROOT = path.resolve(
  REPO_ROOT,
  '..',
  '\u7d20\u6750',
  'sanming_v1_minimal_delivery_20260819_011317',
  'prototype',
  'audio',
  'incoming_20260813',
  '\u4e09\u547d\u65e0\u5e38_\u4e2d\u6587\u6613\u8bfb\u7248_20260813',
);
const SOURCE_ROOT = path.resolve(
  process.argv[2] ?? process.env.JWGB_AUDIO_SOURCE_ROOT ?? DELIVERY_ROOT,
);
const CSV_PATH = path.join(SOURCE_ROOT, '\u4e2d\u6587\u6587\u4ef6\u540d\u5bf9\u7167\u8868.csv');
const SOURCE_WAV_ROOT = path.join(SOURCE_ROOT, '\u4e2d\u6587\u6613\u8bfb\u7248_48kHz_24bit_WAV');
const RUNTIME_AUDIO_ROOT = path.join(REPO_ROOT, 'apps', 'web', 'public', 'audio', 'runtime');
const SKILL_OUTPUT_ROOT = path.join(RUNTIME_AUDIO_ROOT, 'skills');
const MANIFEST_PATH = path.join(RUNTIME_AUDIO_ROOT, 'audio-manifest.json');

const TARGET_SAMPLE_RATE = 24_000;
const TARGET_BIT_DEPTH = 16;
const LOOP_CROSSFADE_MS = 30;

const CSV_FIELD = {
  hero: '\u5bf9\u8c61/\u89d2\u8272',
  skill: '\u6280\u80fd/\u5185\u5bb9',
  chineseName: '\u4e2d\u6587\u6587\u4ef6\u540d',
  relativePath: '\u4e2d\u6587\u76f8\u5bf9\u8def\u5f84',
  englishName: '\u539f\u82f1\u6587\u6587\u4ef6\u540d',
  durationSeconds: '\u5b9e\u9645\u65f6\u957f_\u79d2',
  fileStatus: '\u6587\u4ef6\u72b6\u6001',
};

const IMPACT_HERO_IDS = new Set(
  Array.from({ length: 38 }, (_, index) => `H${String(index + 1).padStart(3, '0')}`).filter(
    (id) => id !== 'H009' && id !== 'H010' && id !== 'H034',
  ),
);
const END_HERO_IDS = new Set([
  'H001',
  'H002',
  'H003',
  'H004',
  'H005',
  'H006',
  'H007',
  'H009',
  'H012',
  'H014',
  'H015',
  'H018',
  'H019',
  'H020',
  'H023',
  'H025',
  'H026',
  'H028',
  'H030',
  'H031',
  'H032',
  'H033',
  'H034',
  'H035',
  'H036',
  'H037',
  'H038',
]);
const LOOP_HERO_IDS = new Set([
  'H002',
  'H003',
  'H006',
  'H007',
  'H018',
  'H030',
  'H031',
  'H033',
  'H036',
  'H038',
]);

const BASE_ASSETS = {
  ui_confirm: runtimeAsset('ui', 'audio/runtime/ui/ui_confirm.wav', 0.62, false, 'confirm'),
  ui_cancel: runtimeAsset('ui', 'audio/runtime/ui/ui_cancel.wav', 0.52, false, 'cancel'),
  ui_error: runtimeAsset('ui', 'audio/runtime/ui/ui_error.wav', 0.62, false, 'error'),
  ui_pickup: runtimeAsset('ui', 'audio/runtime/ui/ui_pickup.wav', 0.58, false, 'pickup'),
  ui_book: runtimeAsset('ui', 'audio/runtime/ui/ui_book.wav', 0.62, false, 'book'),
  ui_equip: runtimeAsset('ui', 'audio/runtime/ui/ui_equip.wav', 0.6, false, 'equip'),
  ui_shop_buy: runtimeAsset('ui', 'audio/runtime/ui/ui_shop_buy.wav', 0.62, false, 'buy'),
  ui_shop_sell: runtimeAsset('ui', 'audio/runtime/ui/ui_shop_sell.wav', 0.58, false, 'sell'),
  ui_respawn: runtimeAsset('ui', 'audio/runtime/ui/ui_respawn.wav', 0.6, false, 'respawn'),
  music_lobby: runtimeAsset('music', 'audio/runtime/music/mus_lobby.ogg', 0.34, true),
  ambience_map: runtimeAsset('ambience', 'audio/runtime/ambience/amb_map_general.ogg', 0.24, true),
};

function runtimeAsset(kind, file, volume, loop, alias) {
  return {
    kind,
    ...(alias ? { alias } : {}),
    file,
    mime: file.endsWith('.ogg') ? 'audio/ogg' : 'audio/wav',
    loop,
    volume,
    status: 'PREVIEW_ONLY',
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }
  if (quoted) {
    throw new Error('CSV contains an unterminated quoted field');
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length < 2) {
    throw new Error('CSV does not contain data rows');
  }

  const headers = rows[0].map((value, index) =>
    index === 0 ? value.replace(/^\uFEFF/, '') : value,
  );
  return rows
    .slice(1)
    .filter((values) => values.some(Boolean))
    .map((values, rowIndex) => {
      if (values.length !== headers.length) {
        throw new Error(
          `CSV row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}`,
        );
      }
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    });
}

function readChunkId(buffer, offset) {
  return buffer.toString('ascii', offset, offset + 4);
}

function decodePcmSample(buffer, offset, bitsPerSample) {
  if (bitsPerSample === 16) {
    return buffer.readInt16LE(offset) / 32_768;
  }
  if (bitsPerSample === 24) {
    const unsigned = buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
    const signed = unsigned & 0x80_0000 ? unsigned - 0x100_0000 : unsigned;
    return signed / 8_388_608;
  }
  if (bitsPerSample === 32) {
    return buffer.readInt32LE(offset) / 2_147_483_648;
  }
  throw new Error(`unsupported PCM bit depth: ${bitsPerSample}`);
}

function decodePcmWav(buffer, sourcePath) {
  if (readChunkId(buffer, 0) !== 'RIFF' || readChunkId(buffer, 8) !== 'WAVE') {
    throw new Error(`${sourcePath} is not a RIFF/WAVE file`);
  }

  let format = null;
  let data = null;
  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const chunkId = readChunkId(buffer, offset);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) {
      throw new Error(`${sourcePath} contains a truncated ${chunkId} chunk`);
    }
    if (chunkId === 'fmt ') {
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      data = buffer.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (!format || !data) {
    throw new Error(`${sourcePath} is missing fmt or data`);
  }
  if (format.audioFormat !== 1) {
    throw new Error(`${sourcePath} must use integer PCM`);
  }
  if (format.channels < 1 || format.channels > 2) {
    throw new Error(`${sourcePath} has unsupported channel count ${format.channels}`);
  }
  const bytesPerSample = format.bitsPerSample / 8;
  const expectedBlockAlign = bytesPerSample * format.channels;
  if (!Number.isInteger(bytesPerSample) || format.blockAlign !== expectedBlockAlign) {
    throw new Error(`${sourcePath} has an invalid PCM block alignment`);
  }

  const frameCount = Math.floor(data.length / format.blockAlign);
  const samples = new Float64Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    const frameOffset = frame * format.blockAlign;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += decodePcmSample(data, frameOffset + channel * bytesPerSample, format.bitsPerSample);
    }
    samples[frame] = sum / format.channels;
  }
  return { ...format, samples };
}

function downsample(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return samples;
  }
  if (sourceRate < targetRate || sourceRate % targetRate !== 0) {
    throw new Error(`unsupported sample-rate conversion ${sourceRate} -> ${targetRate}`);
  }
  const ratio = sourceRate / targetRate;
  const output = new Float64Array(Math.floor(samples.length / ratio));
  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    let sum = 0;
    const sourceStart = outputIndex * ratio;
    for (let sourceIndex = 0; sourceIndex < ratio; sourceIndex += 1) {
      sum += samples[sourceStart + sourceIndex] ?? 0;
    }
    output[outputIndex] = sum / ratio;
  }
  return output;
}

function makeSeamlessLoop(samples, sampleRate) {
  const crossfadeSamples = Math.min(
    Math.floor((sampleRate * LOOP_CROSSFADE_MS) / 1_000),
    Math.floor(samples.length / 8),
  );
  if (crossfadeSamples < 2) {
    return samples;
  }

  const middleLength = samples.length - crossfadeSamples * 2;
  const output = new Float64Array(samples.length - crossfadeSamples);
  output.set(samples.subarray(crossfadeSamples, crossfadeSamples + middleLength), 0);
  for (let index = 0; index < crossfadeSamples; index += 1) {
    const progress = (index + 1) / crossfadeSamples;
    const tail = samples[samples.length - crossfadeSamples + index] ?? 0;
    const head = samples[index] ?? 0;
    output[middleLength + index] = tail * (1 - progress) + head * progress;
  }
  return output;
}

function encodePcm16Wav(samples, sampleRate) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const encoded = sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767);
    buffer.writeInt16LE(encoded, 44 + index * 2);
  }
  return buffer;
}

function assertInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`refusing filesystem operation outside ${parent}: ${target}`);
  }
}

function phasesForHero(heroId) {
  return [
    'cast',
    ...(IMPACT_HERO_IDS.has(heroId) ? ['impact'] : []),
    ...(END_HERO_IDS.has(heroId) ? ['end'] : []),
    ...(LOOP_HERO_IDS.has(heroId) ? ['loop'] : []),
  ];
}

function sourceVariant(heroId, phase) {
  return heroId === 'H018' && phase === 'loop' ? 'v02' : 'v01';
}

function phaseVolume(phase) {
  if (phase === 'cast') return 0.72;
  if (phase === 'impact') return 0.64;
  if (phase === 'end') return 0.5;
  return 0.42;
}

async function cleanGeneratedSkillOutputs() {
  await mkdir(SKILL_OUTPUT_ROOT, { recursive: true });
  const entries = await readdir(SKILL_OUTPUT_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!/^h\d{3}_(cast|impact|end|loop)\.wav$/i.test(entry.name)) {
      continue;
    }
    const target = path.join(SKILL_OUTPUT_ROOT, entry.name);
    assertInside(SKILL_OUTPUT_ROOT, target);
    await rm(target, { recursive: true, force: true });
  }
}

async function validateBaseAssets() {
  for (const asset of Object.values(BASE_ASSETS)) {
    const relative = asset.file.replace(/^audio\/runtime\//, '').split('/');
    const target = path.join(RUNTIME_AUDIO_ROOT, ...relative);
    const details = await stat(target);
    if (!details.isFile() || details.size <= 0) {
      throw new Error(`base runtime audio is missing or empty: ${target}`);
    }
  }
}

async function main() {
  await access(CSV_PATH);
  await access(SOURCE_WAV_ROOT);
  await validateBaseAssets();
  const records = parseCsv(await readFile(CSV_PATH, 'utf8'));
  const sourceByEnglishName = new Map(
    records
      .filter((record) =>
        /^sfx_act_h\d{3}_(cast|impact|end|loop)_v\d{2}\.wav$/.test(
          record[CSV_FIELD.englishName] ?? '',
        ),
      )
      .map((record) => [record[CSV_FIELD.englishName], record]),
  );

  await cleanGeneratedSkillOutputs();
  const assets = { ...BASE_ASSETS };
  const generated = [];

  for (let heroNumber = 1; heroNumber <= 38; heroNumber += 1) {
    const heroId = `H${String(heroNumber).padStart(3, '0')}`;
    const heroSlug = heroId.toLowerCase();
    for (const phase of phasesForHero(heroId)) {
      const variant = sourceVariant(heroId, phase);
      const sourceEnglishName = `sfx_act_${heroSlug}_${phase}_${variant}.wav`;
      const record = sourceByEnglishName.get(sourceEnglishName);
      if (!record) {
        throw new Error(`CSV is missing required source ${sourceEnglishName}`);
      }
      if (record[CSV_FIELD.fileStatus] !== '\u901a\u8fc7') {
        throw new Error(`${sourceEnglishName} is not marked as passed`);
      }

      const relativeParts = record[CSV_FIELD.relativePath].split(/[\\/]/).filter(Boolean);
      const sourcePath = path.join(SOURCE_WAV_ROOT, ...relativeParts);
      const outputName = `${heroSlug}_${phase}.wav`;
      const outputPath = path.join(SKILL_OUTPUT_ROOT, outputName);
      assertInside(SKILL_OUTPUT_ROOT, outputPath);

      const decoded = decodePcmWav(await readFile(sourcePath), sourcePath);
      if (decoded.sampleRate !== 48_000 || decoded.bitsPerSample !== 24 || decoded.channels !== 1) {
        throw new Error(
          `${sourceEnglishName} must be 48kHz/24-bit/mono, got ` +
            `${decoded.sampleRate}Hz/${decoded.bitsPerSample}-bit/${decoded.channels}ch`,
        );
      }
      let samples = downsample(decoded.samples, decoded.sampleRate, TARGET_SAMPLE_RATE);
      if (phase === 'loop') {
        samples = makeSeamlessLoop(samples, TARGET_SAMPLE_RATE);
      }
      await writeFile(outputPath, encodePcm16Wav(samples, TARGET_SAMPLE_RATE));

      const assetId = `sfx_skill_${heroSlug}_${phase}`;
      const durationSeconds = Number((samples.length / TARGET_SAMPLE_RATE).toFixed(3));
      assets[assetId] = {
        kind: 'sfx',
        alias: `${heroSlug}-${phase}`,
        file: `audio/runtime/skills/${outputName}`,
        mime: 'audio/wav',
        loop: phase === 'loop',
        volume: phaseVolume(phase),
        status: 'PREVIEW_ONLY',
        sourceEnglishName,
        sourceChineseName: record[CSV_FIELD.chineseName],
        heroName: record[CSV_FIELD.hero],
        skillName: record[CSV_FIELD.skill],
        phase,
        sourceVariant: variant,
        sourceSampleRate: decoded.sampleRate,
        sampleRate: TARGET_SAMPLE_RATE,
        bitDepth: TARGET_BIT_DEPTH,
        channels: 1,
        durationSeconds,
      };
      generated.push({ heroId, phase, outputPath, durationSeconds });
    }
  }

  if (generated.length !== 110 || Object.keys(assets).length !== 121) {
    throw new Error(
      `unexpected asset count: ${generated.length} skills, ${Object.keys(assets).length} total`,
    );
  }

  const manifest = {
    schema: 'sanming-runtime-audio-v2',
    package: 'sanming_v1_minimal_delivery_20260819_011317',
    sourceCount: records.length,
    runtimeAssetCount: Object.keys(assets).length,
    licenseState: 'PREVIEW_NOT_COMMERCIAL',
    licenseNotice:
      'Source package assets are preview-only. Commercial release requires documented ' +
      'worldwide commercial-use and sublicensing rights.',
    unlockPolicy: 'FIRST_POINTER_OR_KEY_GESTURE',
    conversion: {
      source: '48kHz/24-bit PCM mono',
      runtime: `${TARGET_SAMPLE_RATE}Hz/${TARGET_BIT_DEPTH}-bit PCM mono`,
      loopCrossfadeMs: LOOP_CROSSFADE_MS,
    },
    assets,
    skillAudio: {
      heroCount: 38,
      runtimeFiles: generated.length,
      phaseCounts: {
        cast: generated.filter((entry) => entry.phase === 'cast').length,
        impact: generated.filter((entry) => entry.phase === 'impact').length,
        end: generated.filter((entry) => entry.phase === 'end').length,
        loop: generated.filter((entry) => entry.phase === 'loop').length,
      },
      loading: 'ON_DEMAND',
    },
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const totalBytes = (await Promise.all(generated.map((entry) => stat(entry.outputPath)))).reduce(
    (total, details) => total + details.size,
    0,
  );
  console.log(
    `Prepared ${generated.length} hero skill WAV files (${(totalBytes / 1_048_576).toFixed(2)} MiB)`,
  );
  console.log(`Manifest: ${MANIFEST_PATH}`);
}

await main();
