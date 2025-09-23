const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {}; // { roomCode: [ {id, name} ] }

io.on("connection", socket => {

  socket.on("join", ({ room, name }) => {
    socket.join(room);
    if (!rooms[room]) rooms[room] = [];
    rooms[room].push({ id: socket.id, name });
    io.to(room).emit("user-list", rooms[room]);
    // Notify host about new peer
    socket.to(room).emit("peer-joined", { id: socket.id, name });
  });

  // signaling
  socket.on("signal", ({ target, data }) => {
    if (target) {
      io.to(target).emit("signal", { from: socket.id, data });
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
