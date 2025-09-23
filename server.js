const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

io.on("connection", socket => {
  socket.on("join", ({ room, name, role }) => {
    socket.join(room);
    socket.data.room = room;
    socket.data.name = name;
    socket.data.role = role;

    if (!rooms[room]) rooms[room] = [];
    rooms[room].push({ id: socket.id, name, role });

    updateUsers(room);
  });

  socket.on("signal", msg => {
    if (msg.targetId) io.to(msg.targetId).emit("signal", { ...msg.data, from: socket.id });
    else socket.to(socket.data.room).emit("signal", { ...msg.data, from: socket.id });
  });

  socket.on("disconnect", () => {
    const { room } = socket.data;
    if (room && rooms[room]) {
      rooms[room] = rooms[room].filter(u => u.id !== socket.id);
      updateUsers(room);
    }
  });

  function updateUsers(room) {
    io.to(room).emit("user-list", rooms[room]);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on " + PORT));
