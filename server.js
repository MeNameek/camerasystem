const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const lobbies = {}; // {room: {host:socketId, cameras:{id:{name}}}}

io.on("connection", socket => {
  socket.on("create", room => {
    lobbies[room] = { host: socket.id, cameras: {} };
    socket.join(room);
    socket.emit("created", room);
  });

  socket.on("join", ({ room, name }) => {
    if (!lobbies[room]) return;
    lobbies[room].cameras[socket.id] = { name };
    socket.join(room);
    io.to(lobbies[room].host).emit("cameraList", lobbies[room].cameras);
  });

  socket.on("offer", ({ room, offer }) => {
    const host = lobbies[room]?.host;
    if (host) io.to(host).emit("offer", { id: socket.id, offer });
  });

  socket.on("answer", ({ id, answer }) => {
    io.to(id).emit("answer", answer);
  });

  socket.on("ice", ({ to, candidate }) => {
    io.to(to).emit("ice", { from: socket.id, candidate });
  });

  socket.on("disconnect", () => {
    for (const [room, lobby] of Object.entries(lobbies)) {
      if (socket.id === lobby.host) {
        io.to(room).emit("end");
        delete lobbies[room];
      } else if (lobby.cameras[socket.id]) {
        delete lobby.cameras[socket.id];
        io.to(lobby.host).emit("cameraList", lobby.cameras);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on " + PORT));
