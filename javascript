// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);

// ---------- REDIS ----------
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

// ---------- SOCKET.IO ----------
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST'],
  },
});

// ---------- MIDDLEWARE ----------
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api', limiter);

// ---------- DATABASE ----------
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/roadie', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err));

// ---------- ROUTES ----------
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/vehicles', require('./src/routes/vehicles'));
app.use('/api/chat', require('./src/routes/chat'));
app.use('/api/food', require('./src/routes/food'));
app.use('/api/payments', require('./src/routes/payments'));

// ---------- SOCKET HANDLERS ----------
const chatHandler = require('./src/handlers/chatHandler');
const locationHandler = require('./src/handlers/locationHandler');
const convoyHandler = require('./src/handlers/convoyHandler');

io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  // Authentication
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.join(`user:${decoded.userId}`);
      
      // Store socket ID in Redis
      await redis.hset(`user:${decoded.userId}`, 'socketId', socket.id);
      console.log(`✅ User ${decoded.userId} authenticated`);
    } catch (error) {
      socket.emit('error', { message: 'Authentication failed' });
    }
  });

  // Chat
  socket.on('send_message', (data) => chatHandler.handleSendMessage(io, socket, data, redis));
  socket.on('typing', (data) => chatHandler.handleTyping(io, socket, data));
  socket.on('read_receipt', (data) => chatHandler.handleReadReceipt(io, socket, data));

  // Location
  socket.on('update_location', (data) => locationHandler.handleLocationUpdate(io, socket, data, redis));
  socket.on('get_nearby_cars', (data) => locationHandler.handleNearbyCars(io, socket, data, redis));

  // Convoy
  socket.on('create_convoy', (data) => convoyHandler.handleCreateConvoy(io, socket, data, redis));
  socket.on('join_convoy', (data) => convoyHandler.handleJoinConvoy(io, socket, data, redis));
  socket.on('leave_convoy', (data) => convoyHandler.handleLeaveConvoy(io, socket, data, redis));

  // Disconnect
  socket.on('disconnect', async () => {
    console.log('🔌 Client disconnected:', socket.id);
    if (socket.userId) {
      await redis.hdel(`user:${socket.userId}`, 'socketId');
    }
  });
});

// ---------- ERROR HANDLING ----------
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
});

module.exports = { app, io, redis };
