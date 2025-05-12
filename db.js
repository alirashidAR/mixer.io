const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config(); // Load environment variables from .env file

const mongoURI = process.env.MONGO_URI; // Mongo URI (ensure it's set in your .env)

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Define the user session schema (you can expand as needed)
const userSchema = new mongoose.Schema({
  spotify_id: { type: String, required: true, unique: true },
  access_token: { type: String, required: true },
  refresh_token: { type: String },
  created_at: { type: Date, default: Date.now },
});

const earlyAccessSchema = new mongoose.Schema({
  spotify_email: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);
const EarlyAccess = mongoose.model('EarlyAccess', earlyAccessSchema);

module.exports = { User, EarlyAccess };
