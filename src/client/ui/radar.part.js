// Renders a static map from the collision world, then draws actors around the
// player on the visible canvas. Only the supplied map configuration sets scale
// and offsets; the HUD does not need to know the map's dimensions.
class MapRadar {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.image = null;
  }

  build(world, radar) {
    this.config = radar;
    const canvas = document.createElement('canvas');
    canvas.width = radar.width;
    canvas.height = radar.height;
    const ctx = canvas.getContext('2d');
    const scale = radar.scale;
    const px = x => (x + radar.offsetX) * scale;
    const pz = z => (z + radar.offsetZ) * scale;
    ctx.fillStyle = 'rgba(70,80,84,0.95)';
    ctx.fillRect(0, 0, radar.width, radar.height);
    const colliders = [...world.colliders]
      .filter(w => w.solid && w.top > .3 && w.bottom < 2 && w.hx < 30 && w.tag !== 'deck')
      .sort((a, b) => a.top - b.top);
    for (const wall of colliders) {
      if (wall.bullet === 'pass' && wall.mat !== 'mesh') continue;
      ctx.save();
      ctx.translate(px(wall.x), pz(wall.z));
      ctx.rotate(-wall.yaw);
      const top = wall.top;
      ctx.fillStyle = wall.mat === 'mesh' ? 'rgba(200,200,190,.5)'
        : top > 4 ? '#1d2327' : top > 2 ? '#2d353a'
          : top > 1.3 ? '#3b454b' : '#56616a';
      ctx.fillRect(-wall.hx * scale, -wall.hz * scale, wall.hx * 2 * scale, wall.hz * 2 * scale);
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-wall.hx * scale, -wall.hz * scale, wall.hx * 2 * scale, wall.hz * 2 * scale);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(245,179,33,.35)';
    ctx.setLineDash([6, 4]);
    for (const tunnel of radar.tunnels) {
      ctx.strokeRect(px(tunnel.x), pz(tunnel.z), tunnel.width * scale, tunnel.height * scale);
    }
    this.image = canvas;
    this.scale = scale;
  }

  draw(player, actors) {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const width = canvas.width = canvas.clientWidth * 1.5 | 0;
    const height = canvas.height = canvas.clientHeight * 1.5 | 0;
    ctx.clearRect(0, 0, width, height);
    if (!this.image) return;

    const scale = this.scale;
    const zoom = .55 * (width / 294);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(player.yaw);
    ctx.scale(zoom, zoom);
    ctx.translate(-(player.pos.x + this.config.offsetX) * scale,
      -(player.pos.z + this.config.offsetZ) * scale);
    ctx.globalAlpha = .95;
    ctx.drawImage(this.image, 0, 0);
    ctx.globalAlpha = 1;

    for (const actor of actors) {
      if (actor === player || !(actor.team === player.team || actor.radarT > 0)) continue;
      const x = (actor.pos.x + this.config.offsetX) * scale;
      const z = (actor.pos.z + this.config.offsetZ) * scale;
      if (!actor.alive) {
        if (actor.team !== player.team || actor.deadT > 5) continue;
        ctx.strokeStyle = '#9aa';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - 8, z - 8);
        ctx.lineTo(x + 8, z + 8);
        ctx.moveTo(x + 8, z - 8);
        ctx.lineTo(x - 8, z + 8);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = actor.team === player.team ? '#4fb0ff' : '#ff4a3a';
      if (actor.team === player.team) {
        ctx.save();
        ctx.translate(x, z);
        ctx.rotate(-actor.yaw);
        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.lineTo(8, 9);
        ctx.lineTo(0, 4);
        ctx.lineTo(-8, 9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.globalAlpha = Math.min(1, actor.radarT);
        ctx.beginPath();
        ctx.arc(x, z, 9, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(width / 2, height / 2 - 10);
    ctx.lineTo(width / 2 + 7, height / 2 + 8);
    ctx.lineTo(width / 2, height / 2 + 4);
    ctx.lineTo(width / 2 - 7, height / 2 + 8);
    ctx.closePath();
    ctx.fill();
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 0,
      width / 2, height / 2, width * .45);
    gradient.addColorStop(0, 'rgba(255,255,255,.18)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(width / 2, height / 2);
    ctx.arc(width / 2, height / 2, width * .45, -Math.PI / 2 - .6, -Math.PI / 2 + .6);
    ctx.closePath();
    ctx.fill();
  }
}
