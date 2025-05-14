require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

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


// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));


// Отправка письма
async function sendReminder(email) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.MAIL_FROM,     // example@gmail.com
      pass: process.env.MAIL_PASSWORD
    }
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Please return the power bank',
    text: 'You have rented a power bank over 24 hours ago. Please return it to avoid account ban',
  });
}

// Планировщик
cron.schedule('*/1 * * * *', async () => {
  console.log('🔁 CRON JOB TRIGGERED');

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 60 * 1000);

  const overdueBanks = await PowerBank.find({
    status: 'INUSE',
    rentedAt: { $lte: dayAgo }
  });

  console.log(`[CRON] Found ${overdueBanks.length} overdue powerbanks`);

  for (const bank of overdueBanks) {
    const user = await User.findOne({ userId: bank.userId });

    if (user) {
      if (user.isBanned) {
        console.log(`[CRON] User ${user.userId} is already banned, skipping...`);
        continue;
      }

      if (user.remindersSent >= 3) {
        user.isBanned = true;
        await user.save();
        console.log(`[CRON] User ${user.userId} has been banned after 3 reminders.`);
        continue;
      }

      if (user.email) {
        try {
          await sendReminder(user.email);
          user.remindersSent += 1;
          await user.save();
          console.log(`[CRON] Reminder sent to ${user.email} (${user.remindersSent}/3)`);
        } catch (err) {
          console.error(`[CRON ERROR] Failed to send reminder to ${user.email}:`, err.message);
        }
      }
    }
  }
});




const YOUR_DOMAIN = 'http://192.168.123.7:4242';



// Схема пользователя
const userSchema = new mongoose.Schema({
  userId: String,
  name: String,
  email: String,
  remindersSent: { type: Number, default: 0 },
  isBanned: { type: Boolean, default: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
});


// Station schema
const stationSchema = new mongoose.Schema({
  stationId: Number,
  location: String,
  capacity: Number
});

const Station = mongoose.model('Station', stationSchema);


// ✅ Схема PowerBank
const powerBankSchema = new mongoose.Schema({
  stationId: Number,
  status: { type: String, enum: ['INUSE', 'FREE'], default: 'FREE' },
  userId: { type: String, default: null },  // Добавлено поле userId
  rentedAt: { type: Date, default: null },
  
});

const User = mongoose.model('User', userSchema);
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
          userId: "null",
          rentedAt: null  // По умолчанию неизвестный пользователь
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

app.get('/check-ban', async (req, res) => {
  const { userId } = req.query;
  try {
    const user = await User.findOne({ userId });
    res.json({ isBanned: user?.isBanned || false });
  } catch (err) {
    res.status(500).json({ error: 'Server error checking ban status' });
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

app.get('/get-user', async (req, res) => {
  const { userId } = req.query;
  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});


app.get('/my-powerbanks', async (req, res) => {
  const { userId } = req.query;

  try {
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const powerBanks = await PowerBank.find({ userId, status: 'INUSE' });

    const result = await Promise.all(
      powerBanks.map(async (bank) => {
        const station = await Station.findOne({ stationId: bank.stationId });
        return {
          id: bank._id,
          stationId: bank.stationId,
          location: station ? station.location : 'Unknown',
          rentedAt: bank.rentedAt
        };
      })
    );

    res.json(result);
  } catch (error) {
    console.error('Error fetching user powerbanks:', error.message);
    res.status(500).json({ error: 'Error fetching user powerbanks' });
  }
});


app.post('/return-powerbanks', async (req, res) => {
  const { userId } = req.body;

  try {
    const updatedPowerBanks = await PowerBank.updateMany(
      { userId: userId, status: 'INUSE' },
      { $set: { status: 'FREE', userId: null } }
    );

    console.log(`User ${userId} returned ${updatedPowerBanks.modifiedCount} PowerBanks`);
    res.json({ message: `${updatedPowerBanks.modifiedCount} PowerBanks returned successfully` });

  } catch (error) {
    console.error('Error returning PowerBanks:', error.message);
    res.status(500).json({ error: 'Error returning PowerBanks' });
  }
});

app.post('/register-user', async (req, res) => {
  const { userId, name, email } = req.body;

  try {
    const existing = await User.findOne({ userId });
    if (!existing) {
      await User.create({ userId, name, email });
      console.log(`User ${email} registered`);
    }
    res.status(200).json({ message: 'User registered or already exists' });
  } catch (error) {
    console.error('User registration error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// Получить всех пользователей
app.get('/users', async (req, res) => {
  try {
    const users = await User.find(
      { role: 'user' }, // ← фильтруем только пользователей
      'userId name email role isBanned remindersSent'
    );
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});


// ✅ Обновить статус пользователя (бан / разбан)
app.post('/user-status', async (req, res) => {
  const { userId, action } = req.body;

  if (!userId || !['ban', 'unban'].includes(action)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  try {
    const isBanned = action === 'ban';
    const updatedUser = await User.findOneAndUpdate(
      { userId },
      { $set: { isBanned } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: `User ${userId} was ${isBanned ? 'banned' : 'unbanned'} successfully`
    });
  } catch (error) {
    console.error('[ERROR] Failed to update user status:', error.message);
    res.status(500).json({ error: 'Failed to update user status' });
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
        await PowerBank.findByIdAndUpdate(payment.powerBankId, { status: 'INUSE', userId: payment.userId, rentedAt: new Date() });
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
