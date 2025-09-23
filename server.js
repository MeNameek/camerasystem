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
    // remove old entry if rejoining
    rooms[room] = rooms[room].filter(u => u.id !== socket.id);
    rooms[room].push({ id: socket.id, name: name || "Unknown", role: role || "camera" });
    io.to(room).emit("user-list", rooms[room]);
  });

  // signal forwarding
  // payload contains: { room, target (optional), sdp (optional), candidate (optional) }
  socket.on("signal", ({ room, target, sdp, candidate }) => {
    const payload = { from: socket.id };
    if (sdp) payload.sdp = sdp;
    if (candidate) payload.candidate = candidate;
    if (target) {
      io.to(target).emit("signal", payload);
    } else {
      // broadcast to everyone else in room
      socket.to(room).emit("signal", payload);
    }
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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
