const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Keep track of rooms and connected cameras
const rooms = {}; // { roomCode: [ {id, name} ] }

io.on("connection", socket => {
  socket.on("join", ({ room, name }) => {
    socket.join(room);
    if (!rooms[room]) rooms[room] = [];
    rooms[room].push({ id: socket.id, name });
    io.to(room).emit("user-list", rooms[room]);
  });

  socket.on("signal", ({ room, targetId, data }) => {
    if (targetId) {
      io.to(targetId).emit("signal", data);
    } else {
      socket.to(room).emit("signal", data);
    }
  });

  socket.on("disconnecting", () => {
    for (const room of socket.rooms) {
      if (rooms[room]) {
        rooms[room] = rooms[room].filter(u => u.id !== socket.id);
        io.to(room).emit("user-list", rooms[room]);
      }
    }
  });
});

server.listen(3000, () => console.log("Server running on http://localhost:3000"));
