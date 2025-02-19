const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// ตั้งเส้นทางสำหรับการสร้าง PaymentIntent
router.post('/create-payment-intent', paymentController.createPaymentIntent);

module.exports = router;
