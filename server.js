import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: process.env.PORT || 3000 });

let rooms = {};

wss.on("connection", ws => {
    ws.on("message", msg => {
        const data = JSON.parse(msg);

        // Opprett rom
        if (data.type === "create_room") {
            const code = Math.random().toString(36).substring(2, 6).toUpperCase();
            rooms[code] = { players: [] };
            ws.room = code;
            rooms[code].players.push(ws);

            ws.send(JSON.stringify({ type: "room_created", code }));
        }

        // Bli med i rom
        if (data.type === "join_room") {
            const code = data.code;
            if (rooms[code] && rooms[code].players.length < 2) {
                ws.room = code;
                rooms[code].players.push(ws);

                ws.send(JSON.stringify({ type: "room_joined", code }));

                // Si fra til spiller 1 at spiller 2 kom inn
                rooms[code].players.forEach(p => {
                    if (p !== ws) {
                        p.send(JSON.stringify({ type: "player_joined" }));
                    }
                });
            } else {
                ws.send(JSON.stringify({ type: "room_error", message: "Rommet finnes ikke eller er fullt" }));
            }
        }

        // Synkroniser spilldata
        if (data.type === "update") {
            const code = ws.room;
            if (!rooms[code]) return;

            rooms[code].players.forEach(p => {
                if (p !== ws) {
                    p.send(JSON.stringify({
                        type: "update",
                        x: data.x,
                        y: data.y,
                        dir: data.dir,
                        shooting: data.shooting
                    }));
                }
            });
        }
    });

    ws.on("close", () => {
        const code = ws.room;
        if (rooms[code]) {
            rooms[code].players = rooms[code].players.filter(p => p !== ws);
            if (rooms[code].players.length === 0) {
                delete rooms[code];
            }
        }
    });
});
