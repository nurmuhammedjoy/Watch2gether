const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// In-memory room state
const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      videoUrl: "",
      playing: false,
      currentTime: 0,
      lastUpdated: Date.now(),
      host: null,
      members: new Set(),
    };
  }
  return rooms[roomId];
}

// REST: create a new room
app.post("/api/rooms", (req, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  const room = getOrCreateRoom(roomId);
  res.json({ roomId: room.id });
});

// REST: get room state
app.get("/api/rooms/:roomId", (req, res) => {
  const room = rooms[req.params.roomId.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({
    id: room.id,
    videoUrl: room.videoUrl,
    playing: room.playing,
    currentTime: room.currentTime,
    memberCount: room.members.size,
  });
});

io.on("connection", (socket) => {
  let currentRoom = null;
  let username = "Guest";

  socket.on("join-room", ({ roomId, name }) => {
    roomId = (roomId || "").toUpperCase();
    username = name || "Guest";

    const room = getOrCreateRoom(roomId);
    currentRoom = roomId;

    socket.join(roomId);
    room.members.add(socket.id);

    // Assign host if room is empty
    if (!room.host || !io.sockets.sockets.get(room.host)) {
      room.host = socket.id;
    }

    const isHost = room.host === socket.id;

    // Send current state to the new joiner
    socket.emit("room-state", {
      roomId,
      videoUrl: room.videoUrl,
      playing: room.playing,
      currentTime: room.currentTime,
      isHost,
      memberCount: room.members.size,
    });

    // Notify others
    socket.to(roomId).emit("user-joined", {
      name: username,
      memberCount: room.members.size,
    });

    io.to(roomId).emit("member-count", { count: room.members.size });
  });

  socket.on("set-video", ({ url }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;

    room.videoUrl = url;
    room.currentTime = 0;
    room.playing = false;

    io.to(currentRoom).emit("video-changed", { url, currentTime: 0 });
  });

  socket.on("play", ({ currentTime }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;

    room.playing = true;
    room.currentTime = currentTime;
    room.lastUpdated = Date.now();

    socket.to(currentRoom).emit("play", { currentTime });
  });

  socket.on("pause", ({ currentTime }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;

    room.playing = false;
    room.currentTime = currentTime;
    room.lastUpdated = Date.now();

    socket.to(currentRoom).emit("pause", { currentTime });
  });

  socket.on("seek", ({ currentTime }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;

    room.currentTime = currentTime;
    room.lastUpdated = Date.now();

    socket.to(currentRoom).emit("seek", { currentTime });
  });

  socket.on("sync-request", () => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;

    // Calculate drift
    const elapsed = room.playing ? (Date.now() - room.lastUpdated) / 1000 : 0;
    const adjustedTime = room.currentTime + elapsed;

    socket.emit("sync-response", {
      currentTime: adjustedTime,
      playing: room.playing,
    });
  });

  socket.on("chat", ({ message }) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit("chat", {
      name: username,
      message,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
  });

  socket.on("disconnect", () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    room.members.delete(socket.id);

    // Reassign host
    if (room.host === socket.id) {
      room.host = [...room.members][0] || null;
      if (room.host) {
        io.to(room.host).emit("promoted-to-host");
      }
    }

    io.to(currentRoom).emit("user-left", {
      name: username,
      memberCount: room.members.size,
    });
    io.to(currentRoom).emit("member-count", { count: room.members.size });

    // Clean up empty rooms after 10 min
    if (room.members.size === 0) {
      setTimeout(() => {
        if (rooms[currentRoom]?.members.size === 0) {
          delete rooms[currentRoom];
        }
      }, 600000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎬 SyncWatch running at http://localhost:${PORT}\n`);
});
