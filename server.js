require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: 'application/json' }));

const YOUR_DOMAIN = 'http://192.168.226.7:4242'; // // this is real ip(for testing with my phone) if u need an emulator replace to http://10.0.2.2:4242

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Схема и модель платежа
const paymentSchema = new mongoose.Schema({
  amount: Number,
  currency: String,
  sessionId: String,
  status: String,
  createdAt: { type: Date, default: Date.now }
});

const Payment = mongoose.model('Payment', paymentSchema);

// Маршрут для создания Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { amount } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Power Bank Rental',
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      success_url: `${YOUR_DOMAIN}/success`,
      cancel_url: `${YOUR_DOMAIN}/cancel`,
    });

    // Сохраняем в MongoDB
    const payment = new Payment({
      amount: amount,
      currency: 'usd',
      sessionId: session.id,
      status: 'paid',
    });

    await payment.save();

    res.json({ url: session.url });

  } catch (error) {
    console.error('Error creating Checkout Session:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Webhook для обновления статуса платежа
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // Обновляем статус платежа в базе данных
      await Payment.findOneAndUpdate(
        { sessionId: session.id },
        { status: 'paid' }
      );

      console.log(`Payment ${session.id} successfully completed.`);
    }

    res.json({ received: true });

  } catch (err) {
    console.error(`Webhook error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Успешная оплата
app.get('/success', (req, res) => {
  res.send("<h1>Payment Successful!</h1><p>Thank you for your purchase.</p>");
});

// Отмененная оплата
app.get('/cancel', (req, res) => {
  res.send("<h1>Payment Canceled</h1><p>The payment was canceled.</p>");
});

// Запуск сервера
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Server running on http://10.0.2.2:${PORT}`);
});
