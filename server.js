const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {}; // { roomCode: [ { id, name, role } ] }

io.on("connection", socket => {
  socket.on("join", ({ room, name, role }) => {
    socket.join(room);
    if (!rooms[room]) rooms[room] = [];
    rooms[room].push({ id: socket.id, name: name || "Unknown", role: role || "camera" });
    io.to(room).emit("user-list", rooms[room]);
  });

  socket.on("signal", ({ room, target, sdp, candidate }) => {
    const payload = {};
    if (sdp) payload.sdp = sdp;
    if (candidate) payload.candidate = candidate;
    payload.from = socket.id;
    if (target) io.to(target).emit("signal", payload);
    else socket.to(room).emit("signal", payload);
  });

  socket.on("disconnecting", () => {
    for (const r of socket.rooms) {
      if (rooms[r]) {
        rooms[r] = rooms[r].filter(u => u.id !== socket.id);
        io.to(r).emit("user-list", rooms[r]);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
