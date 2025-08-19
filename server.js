import { createServer } from "http";
import { Server } from "socket.io";
import { platform, cpus } from "os";

const CONFIG = {
  PORT: process.env.PORT || 3001,
  ALLOWED_ORIGINS: [
    "http://localhost:3000",
    "https://unjob.ai",
    "http://unjob.ai",
  ],
};

const startTime = new Date();
const onlineUsers = new Map();
const userSockets = new Map();

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const log = (level, context, message) => {
  const timestamp = new Date().toISOString();
  let levelColor = COLORS.reset;
  switch (level) {
    case "INFO":
      levelColor = COLORS.green;
      break;
    case "WARN":
      levelColor = COLORS.yellow;
      break;
    case "ERROR":
      levelColor = COLORS.red;
      break;
    case "DEBUG":
      levelColor = COLORS.magenta;
      break;
  }
  console.log(
    `${COLORS.dim}${timestamp}${COLORS.reset} ${levelColor}[${level}]${COLORS.reset} ${COLORS.cyan}[${context}]${COLORS.reset} - ${message}`
  );
};

const httpServer = createServer((req, res) => {
  const origin = req.headers.origin;
  if (CONFIG.ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  if (req.url === "/api/health" && req.method === "GET") {
    const uptimeInSeconds = Math.floor((new Date() - startTime) / 1000);
    const memoryUsage = process.memoryUsage();
    const healthStatus = {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "unjob-socket-server",
      uptime: `${uptimeInSeconds} seconds`,
      nodeVersion: process.version,
      platform: platform(),
      cpuCount: cpus().length,
      memory: {
        rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      },
      connectedClients: io.engine.clientsCount,
      onlineUsers: onlineUsers.size,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(healthStatus));
  } else {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Socket.IO Server is running");
  }
});

const io = new Server(httpServer, {
  cors: {
    origin: CONFIG.ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
});

const broadcastOnlineUsers = (socket) => {
  const onlineUserIds = Array.from(onlineUsers.keys());
  (socket || io).emit("onlineUsersList", onlineUserIds);
};

const handleUserConnection = (socket, userId) => {
  onlineUsers.set(userId, { socketId: socket.id, status: "online" });
  userSockets.set(socket.id, userId);

  log(
    "INFO",
    "Status",
    `User ${userId} is now online. Total online: ${onlineUsers.size}`
  );
  socket.broadcast.emit("userOnline", userId);
  broadcastOnlineUsers();
};

const handleUserDisconnection = (socket) => {
  for (const room of socket.rooms) {
    if (room !== socket.id) {
      socket
        .to(room)
        .emit("user-left-room", { userId: userSockets.get(socket.id), room });
    }
  }

  const disconnectedUserId = userSockets.get(socket.id);
  if (disconnectedUserId) {
    onlineUsers.delete(disconnectedUserId);
    userSockets.delete(socket.id);
    log(
      "INFO",
      "Status",
      `User ${disconnectedUserId} is now offline. Total online: ${onlineUsers.size}`
    );
    socket.broadcast.emit("userOffline", disconnectedUserId);
    broadcastOnlineUsers();
  }
};

io.on("connection", (socket) => {
  log("INFO", "Connection", `New client connected: ${socket.id}`);

  const userId = socket.handshake.query.userId;
  if (userId && typeof userId === "string") {
    handleUserConnection(socket, userId);
  } else {
    log(
      "WARN",
      "Connection",
      `Connection attempt without userId from ${socket.id}`
    );
  }

  socket.on("joinConversation", (conversationId) => {
    if (!conversationId) return;
    socket.join(conversationId);
    log(
      "INFO",
      "Room",
      `User ${userId} (${socket.id}) joined conversation: ${conversationId}`
    );
  });

  socket.on("sendMessage", (message) => {
    const { conversationId } = message;
    if (!conversationId) {
      socket.emit("error", { message: "Message must have a conversationId." });
      return;
    }
    socket.to(conversationId).emit("newMessage", message);
  });

  socket.on("messageRead", ({ conversationId, userId, messageIds }) => {
    if (!conversationId || !userId || !messageIds) return;
    socket
      .to(conversationId)
      .emit("messageRead", { conversationId, userId, messageIds });
  });

  socket.on("startTyping", ({ conversationId, userId }) => {
    if (!conversationId || !userId) return;
    socket.to(conversationId).emit("startTyping", { conversationId, userId });
  });

  socket.on("stopTyping", ({ conversationId, userId }) => {
    if (!conversationId || !userId) return;
    socket.to(conversationId).emit("stopTyping", { conversationId, userId });
  });

  socket.on("request-online-users", () => {
    broadcastOnlineUsers(socket);
  });

  socket.on("call-user", (data) => {
    const { to, from, signal } = data;
    const recipient = onlineUsers.get(to);
    if (recipient) {
      io.to(recipient.socketId).emit("incoming-call", { from, signal });
      log("INFO", "WebRTC", `Relaying call from ${from} to ${to}`);
    } else {
      log("WARN", "WebRTC", `Call recipient ${to} not found or offline.`);
    }
  });

  socket.on("answer-made", (data) => {
    const { to, from, signal } = data;
    const originalCaller = onlineUsers.get(to);
    if (originalCaller) {
      io.to(originalCaller.socketId).emit("call-accepted", { from, signal });
      log("INFO", "WebRTC", `Relaying call answer from ${from} to ${to}`);
    }
  });

  socket.on("ice-candidate", (data) => {
    const { to, candidate } = data;
    const recipient = onlineUsers.get(to);
    if (recipient) {
      io.to(recipient.socketId).emit("ice-candidate", {
        from: userSockets.get(socket.id),
        candidate,
      });
    }
  });

  socket.on("error", (err) => {
    log(
      "ERROR",
      "Socket",
      `Socket error for user ${userId} (${socket.id}): ${err.message}`
    );
  });

  socket.on("disconnecting", (reason) => {
    log(
      "INFO",
      "Connection",
      `Client disconnecting: ${socket.id}. Reason: ${reason}`
    );
    handleUserDisconnection(socket);
  });
});

const shutdown = (signal) => {
  log("WARN", "Server", `Received ${signal}. Shutting down gracefully...`);
  io.close(() => {
    log("INFO", "Server", "All Socket.IO connections closed.");
  });
  httpServer.close(() => {
    log("INFO", "Server", "HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    log("ERROR", "Server", "Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 10000);
};

httpServer.listen(CONFIG.PORT, () => {
  log("INFO", "Server", `Server is listening on port ${CONFIG.PORT}`);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
