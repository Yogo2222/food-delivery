var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require('cors');
var fs = require('fs');
var mysql = require('mysql2');
const WebSocket = require('ws');

// เพิ่ม API สำหรับรับคำสั่งซื้อ
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server, {
  cors: {
    origin: "http://192.168.1.2:3001",  // ตั้งค่า origin ของ client
    methods: ["GET", "POST"]
  }
});
var serverPort = 3001;

var user_socket_connect_list = [];

// เชื่อมต่อฐานข้อมูล MySQL
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "food_delivery",
});

db.connect((err) => {
  if (err) {
    console.error("❌ MySQL Error: " + err.message);
  } else {
    console.log("✅ MySQL Connected");
  }
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

const corsOptions = {
  origin: "http://localhost:4200",
};

app.use(cors(corsOptions));

// เส้นทางสำหรับหน้าร้านค้า
app.get('/store', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'store.html')); // เส้นทางที่เก็บไฟล์ store.html
});

// ฟังก์ชัน processOrder
const processOrder = (orderData, cartItems, callback) => {
  const orderSql = `INSERT INTO orders (name, address, phone, payment_method, status) VALUES (?, ?, ?, ?, ?)`;
  const values = [orderData.name, orderData.address, orderData.phoneNumber, orderData.paymentMethod, 'pending'];

  db.query(orderSql, values, (err, result) => {
    if (err) {
      console.error("Error inserting order:", err);
      return;
    }

    const orderId = result.insertId;  // ได้รับ order_id
    console.log("Order inserted with ID:", orderId);

    insertOrderItems(orderId, cartItems, () => {
      callback(orderId);  // เรียก callback ส่ง orderId
    });
  });
};

// ฟังก์ชันแทรกรายการสินค้า
const insertOrderItems = (orderId, cartItems, callback) => {
  const itemsSql = "INSERT INTO order_items (order_id, product_name, price, quantity, special_instructions) VALUES ?";
  const values = cartItems.map(item => [
    orderId,
    item.name,
    item.price,
    item.quantity,
    item.specialInstructions || null
  ]);

  db.query(itemsSql, [values], (err, result) => {
    if (err) {
      console.error("Error inserting items:", err);
      return;
    }

    console.log("Items inserted successfully");
    callback();  // เรียก callback หลังจากการแทรกรายการสำเร็จ
  });
};

// API รับคำสั่งซื้อ
app.post("/api/orders", (req, res) => {
  console.log("Received Order Data:", req.body);  // ตรวจสอบข้อมูลคำสั่งซื้อที่รับเข้าม
  const { name, address, phoneNumber, paymentMethod, cartItems } = req.body;

  if (!name || !address || !phoneNumber || !paymentMethod || !cartItems || cartItems.length === 0) {
    return res.status(400).json({ error: "ข้อมูลคำสั่งซื้อไม่ครบถ้วน" });
  }

  processOrder({ name, address, phoneNumber, paymentMethod }, cartItems, (orderId) => {
    io.emit("new_order", { 
      orderId,
      name, 
      address, 
      phone: phoneNumber,
      paymentMethod,
      cartItems 
    });

    console.log("ส่งคำสั่งซื้อไปยังร้านค้า: ", { name, address, phone: phoneNumber });
    res.json({ success: true, orderId });  // ส่ง response พร้อมเลขออเดอร์กลับไป
  });
});

// API สำหรับร้านค้ายืนยันการรับออเดอร์ (ไม่อัปเดตสถานะในฐานข้อมูล)
app.post("/api/orders/accept", (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: "ต้องการข้อมูล orderId" });
  }

  // ไม่ทำการอัปเดตสถานะในฐานข้อมูล
  io.emit("order_accepted", { orderId });

  console.log("ออเดอร์ได้รับการยืนยัน, orderId:", orderId);
  res.json({ success: true });
});

// WebSocket สำหรับแจ้งเตือนร้านค้า
io.on("connection", (socket) => {
  console.log("📡 ร้านค้าเชื่อมต่อ WebSocket");

  // เมื่อได้รับการยืนยันจากร้านค้า
  socket.on('order_confirmed', (orderData) => {
    io.emit("order_confirmed", {
      orderId: orderData.orderId,
      customerName: orderData.customerName,
      orderDetails: orderData.orderDetails,
      status: 'confirmed'
    });
    console.log("ออเดอร์ได้รับการยืนยัน:", orderData);
  });

  socket.on("disconnect", () => {
    console.log("🔌 ร้านค้าตัดการเชื่อมต่อ WebSocket");
  });
});

// import express inside dynamic added.
fs.readdirSync('./controllers').forEach((file) => {
  if (file.substr(-3) == ".js") {
    route = require('./controllers/' + file);
    route.controller(app, io, user_socket_connect_list);
  }
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;

server.listen(serverPort);
console.log("✅ Server Running at Port: " + serverPort);
