import './styles.css';
import { GameShell } from './app/game-shell';
import { resolveWebRuntimeMode } from './runtime/web-runtime-mode';

const rootCandidate = document.querySelector<HTMLElement>('#app');
if (!rootCandidate) {
  throw new Error('missing #app root');
}
const root: HTMLElement = rootCandidate;

const search = new URLSearchParams(window.location.search);
const directBattle =
  resolveWebRuntimeMode(search.get('mode')) === 'local' ||
  search.has('active') ||
  search.has('spawn');

async function startApplication(): Promise<void> {
  const game = directBattle
    ? new (await import('./app/game-app')).GameApp(root, { mode: 'local' })
    : new GameShell(root);
  game.start();
  window.addEventListener('pagehide', () => game.dispose(), { once: true });
}

void startApplication();
