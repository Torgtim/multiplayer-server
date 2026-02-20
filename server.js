import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: process.env.PORT || 3000 });

let rooms = {}; // { CODE: { players: { id: {x,y,dir,skin,name,hp} } } }

function makeRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

wss.on("connection", ws => {
  ws.id = Math.random().toString(36).substring(2, 10);
  ws.room = null;

  ws.on("message", msg => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      return;
    }

    // Create room
    if (data.type === "create_room") {
      const code = makeRoomCode();
      rooms[code] = { players: {} };
      rooms[code].players[ws.id] = {
        x: 0,
        y: 0,
        dir: 0,
        skin: "Default",
        name: data.name || "Player",
        hp: 100
      };
      ws.room = code;
      ws.send(JSON.stringify({ type: "room_created", code, id: ws.id }));
      broadcastRoom(code);
    }

    // Join room
    if (data.type === "join_room") {
      const code = data.code;
      if (!rooms[code]) {
        rooms[code] = { players: {} };
      }
      rooms[code].players[ws.id] = {
        x: 0,
        y: 0,
        dir: 0,
        skin: "Default",
        name: data.name || "Player",
        hp: 100
      };
      ws.room = code;
      ws.send(JSON.stringify({ type: "room_joined", code, id: ws.id }));
      broadcastRoom(code);
    }

    // Update player
    if (data.type === "update" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      if (!room.players[ws.id]) return;
      room.players[ws.id].x = data.x;
      room.players[ws.id].y = data.y;
      room.players[ws.id].dir = data.dir;
      room.players[ws.id].skin = data.skin || room.players[ws.id].skin;
      room.players[ws.id].name = data.name || room.players[ws.id].name;
      broadcastRoom(ws.room);
    }

    // Hit event (for HP sync)
    if (data.type === "hit" && ws.room && rooms[ws.room]) {
      const room = rooms[ws.room];
      const targetId = data.targetId;
      if (room.players[targetId]) {
        room.players[targetId].hp -= data.damage || 10;
        if (room.players[targetId].hp < 0) room.players[targetId].hp = 0;
        broadcastRoom(ws.room);
      }
    }
  });

  ws.on("close", () => {
    if (ws.room && rooms[ws.room]) {
      delete rooms[ws.room].players[ws.id];
      if (Object.keys(rooms[ws.room].players).length === 0) {
        delete rooms[ws.room];
      } else {
        broadcastRoom(ws.room);
      }
    }
  });
});

function broadcastRoom(code) {
  const room = rooms[code];
  if (!room) return;
  const payload = JSON.stringify({
    type: "players",
    players: room.players
  });

  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.room === code) {
      client.send(payload);
    }
  });
}
