import { MockProviders } from './engine/providers';
import { Realm } from './engine/realm';
import { Hud, showIntro } from './ui/hud';
import { World } from './world/world';

const realm = new Realm(new MockProviders());
const world = new World(document.getElementById('world')!, realm);
const hud = new Hud(realm, world);
showIntro();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  realm.tick(dt);
  world.update(dt, now / 1000);
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('beforeunload', () => realm.save());
