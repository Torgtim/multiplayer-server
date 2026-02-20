import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: process.env.PORT || 3000 });

// === WORLD SETTINGS ===
const WORLD_SIZE = 1500;
const MAX_PICKUPS = 8;

// === ROOM STRUCTURE ===
// rooms[code] = {
//   players: { id:{...} },
//   pickups: { pid:{...} },
//   stats: { id:{kills,deaths,damage} },
//   nextPickupId: 1
// }

let rooms = {};

function makeRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function randomPos() {
  return {
    x: Math.floor(Math.random() * WORLD_SIZE) - WORLD_SIZE / 2,
    y: Math.floor(Math.random() * WORLD_SIZE) - WORLD_SIZE / 2
  };
}

function spawnPickup(room) {
  const id = "p" + room.nextPickupId++;
  const types = ["ammo", "speed", "shield", "damage"];
  const type = types[Math.floor(Math.random() * types.length)];
  const pos = randomPos();

  room.pickups[id] = {
    id,
    type,
    x: pos.x,
    y: pos.y,
    amount: type === "ammo" ? 15 : 1
  };
}

setInterval(() => {
  for (const code in rooms) {
    const room = rooms[code];
    if (!room) continue;

    const count = Object.keys(room.pickups).length;
    if (count < MAX_PICKUPS) spawnPickup(room);

    broadcastRoom(code);
  }
}, 4000);

// === CONNECTION ===
wss.on("connection", ws => {
  ws.id = Math.random().toString(36).substring(2, 10);
  ws.room = null;

  ws.on("message", raw => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    // === CREATE ROOM ===
    if (data.type === "create_room") {
      const code = makeRoomCode();
      const pos = randomPos();

      rooms[code] = {
        players: {},
        pickups: {},
        stats: {},
        nextPickupId: 1
      };

      rooms[code].players[ws.id] = {
        x: pos.x,
        y: pos.y,
        dir: 0,
        skin: "Default",
        name: data.name || "Player",
        hp: 100,
        ammo: 30,
        frozenUntil: 0,
        poisonUntil: 0,
        poisonDamage: 0
      };

      rooms[code].stats[ws.id] = { kills: 0, deaths: 0, damage: 0 };

      ws.room = code;
      ws.send(JSON.stringify({
        type: "room_created",
        code,
        id: ws.id,
        worldSize: WORLD_SIZE
      }));

      broadcastRoom(code);
    }

    // === JOIN ROOM ===
    if (data.type === "join_room") {
      const code = data.code;
      if (!rooms[code]) {
        rooms[code] = {
          players: {},
          pickups: {},
          stats: {},
          nextPickupId: 1
        };
      }

      const pos = randomPos();

      rooms[code].players[ws.id] = {
        x: pos.x,
        y: pos.y,
        dir: 0,
        skin: "Default",
        name: data.name || "Player",
        hp: 100,
        ammo: 30,
        frozenUntil: 0,
        poisonUntil: 0,
        poisonDamage: 0
      };

      rooms[code].stats[ws.id] = rooms[code].stats[ws.id] || {
        kills: 0,
        deaths: 0,
        damage: 0
      };

      ws.room = code;
      ws.send(JSON.stringify({
        type: "room_joined",
        code,
        id: ws.id,
        worldSize: WORLD_SIZE
      }));

      broadcastRoom(code);
    }

    // === UPDATE PLAYER ===
    if (data.type === "update" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      const p = room.players[ws.id];
      if (!p) return;

      // Anti‑cheat: clamp pos
      const half = WORLD_SIZE / 2;
      p.x = Math.max(-half + 20, Math.min(half - 20, data.x));
      p.y = Math.max(-half + 20, Math.min(half - 20, data.y));

      p.dir = data.dir;
      p.skin = data.skin || p.skin;
      p.name = data.name || p.name;
      p.hp = data.hp ?? p.hp;
      p.ammo = data.ammo ?? p.ammo;

      broadcastRoom(ws.room);
    }

    // === HIT ===
    if (data.type === "hit" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      const targetId = data.targetId;
      const dmg = data.damage || 20;

      if (!room.players[targetId]) return;

      const target = room.players[targetId];

      // Freeze check
      if (target.frozenUntil > Date.now()) {
        // still take damage
      }

      // Shield check
      if (target.shield > 0) {
        target.shield -= dmg;
        if (target.shield < 0) target.shield = 0;
      } else {
        target.hp -= dmg;
      }

      room.stats[ws.id].damage += dmg;

      let killEvent = null;

      if (target.hp <= 0) {
        target.hp = 0;

        room.stats[ws.id].kills++;
        room.stats[targetId].deaths++;

        const pos = randomPos();
        target.x = pos.x;
        target.y = pos.y;
        target.hp = 100;
        target.ammo = 30;

        killEvent = {
          type: "killfeed",
          killer: room.players[ws.id].name,
          victim: room.players[targetId].name
        };
      }

      broadcastRoom(ws.room, killEvent);
    }

    // === FREEZE ===
    if (data.type === "freeze" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      const targetId = data.targetId;
      const duration = data.duration;

      if (!room.players[targetId]) return;

      room.players[targetId].frozenUntil = Date.now() + duration;

      // send effect
      wss.clients.forEach(c => {
        if (c.room === ws.room) {
          c.send(JSON.stringify({
            type: "freeze_effect",
            targetId,
            duration
          }));
        }
      });
    }

    // === POISON ===
    if (data.type === "poison" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      const targetId = data.targetId;
      const dmg = data.damage;

      if (!room.players[targetId]) return;

      room.players[targetId].poisonUntil = Date.now() + 3000;
      room.players[targetId].poisonDamage = dmg;

      wss.clients.forEach(c => {
        if (c.room === ws.room) {
          c.send(JSON.stringify({
            type: "poison_effect",
            targetId,
            damage: dmg
          }));
        }
      });
    }

    // === PICKUP ===
    if (data.type === "pickup" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      const pid = data.id;
      const p = room.players[ws.id];
      if (!p || !room.pickups[pid]) return;

      const pk = room.pickups[pid];

      if (pk.type === "ammo") p.ammo += pk.amount;
      if (pk.type === "speed") p.speedBoostUntil = Date.now() + 3000;
      if (pk.type === "shield") p.shield = 50;
      if (pk.type === "damage") p.damageBoostUntil = Date.now() + 3000;

      delete room.pickups[pid];
      broadcastRoom(ws.room);
    }

    // === SCOREBOARD ===
    if (data.type === "scoreboard" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      ws.send(JSON.stringify({
        type: "scoreboard",
        stats: room.stats,
        players: room.players
      }));
    }
  });

  ws.on("close", () => {
    if (ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      delete room.players[ws.id];
      delete room.stats[ws.id];

      if (Object.keys(room.players).length === 0) {
        delete rooms[ws.room];
      } else {
        broadcastRoom(ws.room);
      }
    }
  });
});

// === BROADCAST ===
function broadcastRoom(code, extraEvent = null) {
  const room = rooms[code];
  if (!room) return;

  const payload = JSON.stringify({
    type: "players",
    players: room.players,
    pickups: room.pickups,
    stats: room.stats,
    worldSize: WORLD_SIZE
  });

  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.room === code) {
      client.send(payload);
      if (extraEvent) client.send(JSON.stringify(extraEvent));
    }
  });
}
