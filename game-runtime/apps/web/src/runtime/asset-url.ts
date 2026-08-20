function trailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

const HERO_ASSET_ID = /^H(?:00[1-9]|0[12]\d|03[0-8])$/;

export function appendAssetVersion(url: string): string {
  const version = import.meta.env.VITE_ASSET_VERSION?.trim();
  if (!version || /^(?:data|blob):/i.test(url)) {
    return url;
  }
  const pageUrl = typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
  const parsed = new URL(url, pageUrl);
  if (parsed.searchParams.has('v')) {
    return parsed.toString();
  }
  parsed.searchParams.set('v', version);
  return parsed.toString();
}

export function resolveAssetDirectoryUrl(path: string, baseUrl: string): string {
  const normalizedPath = path.replace(/^\/+/, '');
  if (/^https?:\/\//i.test(baseUrl)) {
    return trailingSlash(new URL(normalizedPath, trailingSlash(baseUrl)).toString());
  }

  const normalizedBase = trailingSlash(baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`);
  return trailingSlash(`${normalizedBase}${normalizedPath}`);
}

export function resolveAssetUrl(path: string, baseUrl: string): string {
  const normalizedPath = path.replace(/^\/+/, '');
  if (/^https?:\/\//i.test(baseUrl)) {
    return appendAssetVersion(new URL(normalizedPath, trailingSlash(baseUrl)).toString());
  }

  const normalizedBase = trailingSlash(baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`);
  return appendAssetVersion(`${normalizedBase}${normalizedPath}`);
}

export function webAssetUrl(path: string): string {
  return resolveAssetUrl(path, import.meta.env.BASE_URL);
}

export function webAssetDirectoryUrl(path: string): string {
  return resolveAssetDirectoryUrl(path, import.meta.env.BASE_URL);
}

export function heroPortraitUrl(heroId: string): string {
  const portraitId = HERO_ASSET_ID.test(heroId) ? heroId : 'H009';
  const portraitBase = import.meta.env.VITE_PORTRAIT_BASE_URL?.trim();
  return portraitBase
    ? resolveAssetUrl(`assets/heroes/${portraitId}.webp`, portraitBase)
    : webAssetUrl(`assets/heroes/${portraitId}.webp`);
}

export function heroCardUrl(heroId: string): string {
  const cardId = HERO_ASSET_ID.test(heroId) ? heroId : 'H009';
  return webAssetUrl(`assets/hero-cards/${cardId}.webp`);
}

export function flowAssetUrl(name: 'lobby-environment' | 'lobby-wukong'): string {
  return webAssetUrl(`assets/flow/${name}.webp`);
}

export function activeIconUrl(activeId: string): string {
  return webAssetUrl(`assets/icons/active/${activeId}.webp`);
}

export function passiveIconUrl(passiveId: string): string {
  const match = passiveId.match(/^B(\d{1,2})$/);
  const normalizedId = match ? `B${match[1]?.padStart(2, '0')}` : passiveId;
  return webAssetUrl(`assets/icons/passive/${normalizedId}.webp`);
}

export function equipmentIconUrl(equipmentId: string): string {
  return webAssetUrl(`assets/icons/equipment/${equipmentId}.webp`);
}

export function modelAssetBaseUrl(): string {
  const configured = import.meta.env.VITE_MODEL_BASE_URL?.trim();
  if (configured) {
    return trailingSlash(configured);
  }
  const baseUrl = import.meta.env.BASE_URL;
  if (/^https?:\/\//i.test(baseUrl)) {
    return new URL('models/', trailingSlash(baseUrl)).toString();
  }
  const normalizedBase = trailingSlash(baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`);
  return `${normalizedBase}models/`;
}
