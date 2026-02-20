import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: process.env.PORT || 3000 });

let rooms = {}; 
// rooms[code] = { players: {id:{...}}, pickups: {pid:{...}}, nextPickupId, stats:{id:{kills,deaths,damage}} }

function makeRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function randomPos() {
  return {
    x: Math.floor(Math.random() * 1500) - 750,
    y: Math.floor(Math.random() * 1500) - 750
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
    if (count < 8) spawnPickup(room);
    broadcastRoom(code);
  }
}, 5000);

wss.on("connection", ws => {
  ws.id = Math.random().toString(36).substring(2, 10);
  ws.room = null;

  ws.on("message", raw => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    // create room
    if (data.type === "create_room") {
      const code = makeRoomCode();
      const pos = randomPos();
      rooms[code] = {
        players: {},
        pickups: {},
        nextPickupId: 1,
        stats: {}
      };
      rooms[code].players[ws.id] = {
        x: pos.x,
        y: pos.y,
        dir: 0,
        skin: "Default",
        name: data.name || "Player",
        hp: 100,
        ammo: 30
      };
      rooms[code].stats[ws.id] = { kills: 0, deaths: 0, damage: 0 };
      ws.room = code;
      ws.send(JSON.stringify({ type: "room_created", code, id: ws.id }));
      broadcastRoom(code);
    }

    // join room
    if (data.type === "join_room") {
      const code = data.code;
      if (!rooms[code]) {
        rooms[code] = {
          players: {},
          pickups: {},
          nextPickupId: 1,
          stats: {}
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
        ammo: 30
      };
      rooms[code].stats[ws.id] = rooms[code].stats[ws.id] || { kills: 0, deaths: 0, damage: 0 };
      ws.room = code;
      ws.send(JSON.stringify({ type: "room_joined", code, id: ws.id }));
      broadcastRoom(code);
    }

    // update
    if (data.type === "update" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      const p = room.players[ws.id];
      if (!p) return;
      p.x = data.x;
      p.y = data.y;
      p.dir = data.dir;
      if (data.skin) p.skin = data.skin;
      if (data.name) p.name = data.name;
      p.hp = data.hp ?? p.hp;
      p.ammo = data.ammo ?? p.ammo;
      broadcastRoom(ws.room);
    }

    // hit
    if (data.type === "hit" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      const targetId = data.targetId;
      const dmg = data.damage || 20;
      if (!room.players[targetId]) return;
      room.players[targetId].hp -= dmg;
      room.stats[ws.id] = room.stats[ws.id] || { kills: 0, deaths: 0, damage: 0 };
      room.stats[ws.id].damage += dmg;

      let killEvent = null;
      if (room.players[targetId].hp <= 0) {
        room.players[targetId].hp = 0;
        room.stats[ws.id].kills = (room.stats[ws.id].kills || 0) + 1;
        room.stats[targetId] = room.stats[targetId] || { kills: 0, deaths: 0, damage: 0 };
        room.stats[targetId].deaths = (room.stats[targetId].deaths || 0) + 1;

        const pos = randomPos();
        room.players[targetId].x = pos.x;
        room.players[targetId].y = pos.y;
        room.players[targetId].hp = 100;
        room.players[targetId].ammo = 30;

        killEvent = {
          type: "killfeed",
          killer: room.players[ws.id].name,
          victim: room.players[targetId].name
        };
      }

      broadcastRoom(ws.room, killEvent);
    }

    // pickup collected
    if (data.type === "pickup" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      const pid = data.id;
      const p = room.players[ws.id];
      if (!p || !room.pickups[pid]) return;
      const pk = room.pickups[pid];

      if (pk.type === "ammo") {
        p.ammo += pk.amount;
      } else if (pk.type === "speed") {
        // client håndterer effekter, server bare informerer
      } else if (pk.type === "shield") {
        // kan utvides
      } else if (pk.type === "damage") {
        // kan utvides
      }

      delete room.pickups[pid];
      broadcastRoom(ws.room);
    }

    // scoreboard request
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

function broadcastRoom(code, extraEvent = null) {
  const room = rooms[code];
  if (!room) return;
  const payload = JSON.stringify({
    type: "players",
    players: room.players,
    pickups: room.pickups,
    stats: room.stats
  });

  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.room === code) {
      client.send(payload);
      if (extraEvent) client.send(JSON.stringify(extraEvent));
    }
  });
}
