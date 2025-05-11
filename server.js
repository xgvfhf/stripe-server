require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');

const app = express();
app.use(cors());

// Body parser для всех маршрутов, кроме /webhook
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next();
  } else {
    bodyParser.json()(req, res, next);
  }
});


const YOUR_DOMAIN = 'http://192.168.169.7:4242';

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// ✅ Схема PowerBank
const powerBankSchema = new mongoose.Schema({
  stationId: Number,
  status: { type: String, enum: ['INUSE', 'FREE'], default: 'FREE' },
  userId: { type: String, default: null },  // Добавлено поле userId
  createdAt: { type: Date, default: Date.now }
});

const PowerBank = mongoose.model('PowerBank', powerBankSchema);

// ✅ Схема платежа
const paymentSchema = new mongoose.Schema({
  stationId: Number,
  powerBankId: mongoose.Schema.Types.ObjectId,
  userId: { type: String, default: null },  // Добавлено поле userId
  amount: Number,
  currency: String,
  sessionId: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const Payment = mongoose.model('Payment', paymentSchema);

// ✅ Инициализация данных (для теста)
app.post('/initialize-data', async (req, res) => {
  try {
    const stations = [
      { stationId: 1 },
      { stationId: 2 },
      { stationId: 3 }
    ];

    for (const station of stations) {
      for (let i = 0; i < 6; i++) {
        await PowerBank.create({
          stationId: station.stationId,
          status: 'FREE',
          userId: "null"  // По умолчанию неизвестный пользователь
        });
      }
    }

    console.log("Data initialized successfully.");
    res.json({ message: "Data initialized successfully." });

  } catch (error) {
    console.error('Error initializing data:', error.message);
    res.status(500).json({ error: 'Failed to initialize data' });
  }
});


// ✅ Проверка доступности PowerBank'ов
app.get('/check-availability/:stationId', async (req, res) => {
  const stationId = parseInt(req.params.stationId);

  try {
    const availablePowerBanks = await PowerBank.find({ stationId, status: 'FREE' });

    res.json({
      available: availablePowerBanks.length > 0,
      freePowerBanks: availablePowerBanks.length
    });

  } catch (error) {
    console.error('Error checking availability:', error.message);
    res.status(500).json({ error: 'Error checking availability' });
  }
});

// ✅ Создание Checkout Session с проверкой доступности
// ✅ Создание Checkout Session с userId
app.post('/create-checkout-session', async (req, res) => {
  const { stationId, amount, userId } = req.body;

  try {
    const availablePowerBank = await PowerBank.findOne({ stationId, status: 'FREE' });

    if (!availablePowerBank) {
      return res.status(400).json({ error: 'No FREE PowerBanks available at this station' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: `PowerBank Rental - Station ${stationId}` },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      success_url: `${YOUR_DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${YOUR_DOMAIN}/cancel`,
    });

    await Payment.create({
      stationId,
      powerBankId: availablePowerBank._id,
      userId,  // Сохраняем userId
      amount,
      currency: 'usd',
      sessionId: session.id,
      status: 'pending'
    });

    res.json({ url: session.url });

  } catch (error) {
    console.error('Error creating Checkout Session:', error.message);
    res.status(500).json({ error: error.message });
  }
});


app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  console.log("Webhook received with signature:", sig);

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log("Webhook event parsed successfully:", event);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      console.log("Processing session:", session.id);

      const payment = await Payment.findOneAndUpdate(
        { sessionId: session.id },
        { status: 'paid' },
        { new: true }
      );

      console.log("Payment updated to 'paid':", payment);

      if (payment) {
        await PowerBank.findByIdAndUpdate(payment.powerBankId, { status: 'INUSE', userId: payment.userId });
        console.log(`PowerBank ${payment.powerBankId} set to INUSE by user ${payment.userId}`);
      }
    }

    res.json({ received: true });

  } catch (err) {
    console.error(`Webhook error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

app.get('/payments', async (req, res) => {
  const { userId } = req.query;

  try {
    const payments = await Payment.find({ userId });
    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error.message);
    res.status(500).json({ error: 'Error fetching payments' });
  }
});

// ✅ Успешная оплата
app.get('/success', (req, res) => {
  res.send("<h1>Payment Successful!</h1><p>Thank you for your purchase.</p>");
});

// ✅ Отмененная оплата
app.get('/cancel', (req, res) => {
  res.send("<h1>Payment Canceled</h1><p>The payment was canceled.</p>");
});

// ✅ Запуск сервера
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Server running on ${YOUR_DOMAIN}`);
});
