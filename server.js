const express = require('express');
const querystring = require('querystring');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const db = require('./db');
const ratelimiter = require('express-rate-limit');

const { User, EarlyAccess } = db;

dotenv.config();

const app = express();

// Middleware
app.use(cors({
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session with MongoDB store
app.use(session({
    secret: process.env.SESSION_SECRET || 'some_secret_key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions',
        ttl: 60 * 60 * 24 * 7, // 7 days
    }),
    cookie: {
        secure: false, // true in production
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    }
}));

app.use(ratelimiter({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later.',
}));

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const openrouter_api_key = process.env.OPENROUTER_API_KEY;
const frontend_url = 'https://spot-fro.vercel.app';
const redirect_uri = 'https://mixer-io.vercel.app/callback';

const generateRandomString = (length) => {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

// Routes
app.get('/login', (req, res) => {
    const state = generateRandomString(16);
    req.session.state = state;

    const scope = 'user-read-private user-read-email user-top-read';
    const authQueryParams = querystring.stringify({
        response_type: 'code',
        client_id,
        scope,
        redirect_uri,
        state,
        show_dialog: 'true'
    });

    res.redirect(`https://accounts.spotify.com/authorize?${authQueryParams}`);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;

    console.log(req.session.state)
    if (state !== req.session.state) {
        return res.redirect(`${frontend_url}/#` + querystring.stringify({ error: 'state_mismatch' }));
    }

    try {
        const authOptions = {
            url: 'https://accounts.spotify.com/api/token',
            method: 'post',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64'),
            },
            data: querystring.stringify({
                code,
                redirect_uri,
                grant_type: 'authorization_code',
            }),
        };

        const tokenResponse = await axios(authOptions);
        const accessToken = tokenResponse.data.access_token;
        const refreshToken = tokenResponse.data.refresh_token;

        const userProfileResponse = await axios.get('https://api.spotify.com/v1/me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const spotifyId = userProfileResponse.data.id;

        let user = await User.findOne({ spotify_id: spotifyId });
        if (!user) {
            user = new User({
                spotify_id: spotifyId,
                access_token: accessToken,
                refresh_token: refreshToken,
            });
        } else {
            user.access_token = accessToken;
            user.refresh_token = refreshToken;
        }
        await user.save();

        res.redirect(`${frontend_url}/home?${querystring.stringify({
            user_id: spotifyId,
            auth_success: true
        })}`);
    } catch (error) {
        console.error('Callback Error:', error.message);
        res.redirect(`${frontend_url}/home?${querystring.stringify({
            error: 'authentication_error'
        })}`);
    }
});

app.post('/get_access_token', async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) return res.status(400).json({ error: 'User ID is required' });

    try {
        const user = await User.findOne({ spotify_id: user_id });
        if (!user) return res.status(404).json({ error: 'User not found' });

        return res.json({ access_token: user.access_token });
    } catch (error) {
        console.error('Access Token Error:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/get_user_top_tracks', async (req, res) => {
    const { user_id } = req.query;

    if (!user_id) return res.status(400).json({ error: 'User ID is required' });

    try {
        const user = await User.findOne({ spotify_id: user_id });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const access_token = user.access_token;
        const response = await axios.get('https://api.spotify.com/v1/me/top/artists', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const allArtists = response.data.items.map((artist) => artist.name);
        const artists = allArtists.slice(0, 2);

        const prompt = await generateTextToImagePrompt(artists);
        res.json({ artists, prompt });
    } catch (error) {
        console.error('Top Tracks Error:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

const generateTextToImagePrompt = async (artistNames) => {
    const prompt = `
        You are a prompt engineer for a text-to-image model. 
        Given a list of music artists, generate a highly detailed and cohesive album-poster style image that blends their aesthetics into one harmonious scene.

        Requirements for the prompt you output:
        - Capture the distinct moods and energies of the artists' styles.
        - Specify visual elements fitting each artist's sound: landscapes, objects, environments, or symbols, blending them naturally.
        - Suggest a color palette that reflects the unique aesthetic of each artist while ensuring they work together harmoniously.
        - Describe the overall art style (e.g., surreal, vaporwave, grunge, minimalistic, etc.).
        - Mention lighting, textures, and dynamic elements to give the image life and energy.
        - **Strictly avoid** including any text, faces, or human figures unless otherwise specified.
        - Ensure the description feels original, vivid, and image-focused, with seamless integration of the different artistic influences.
        - The final output should be one detailed paragraph, ready to feed directly into a text-to-image model.

        **Input Example:**  
        Artist: Tame Impala, The Prodigy, Nirvana, Bon Iver

        **Output Example:**  
        A surreal and atmospheric poster that blends the distinct styles of Tame Impala, The Prodigy, Nirvana, and Bon Iver into a cohesive visual masterpiece. Picture a dreamlike scene with a tranquil beach illuminated by soft neon lights, inspired by Tame Impala's smooth, psychedelic sound. The ocean waves reflect vibrant pastel colors, blending into a dark, gritty cityscape where sharp geometric shapes and glitch effects explode outward, channeling The Prodigy's high-energy, industrial spirit. Intertwined in the scene, decaying buildings, overgrown with vines, evoke the raw, rebellious tone of Nirvana's grunge. In the foreground, glowing orbs drift lazily through a misty forest, casting soft light and creating an ethereal atmosphere that captures Bon Iver's introspective, emotional depth. The overall color palette should blend cool blues, neon pinks, muted grays, and vibrant greens, while textures range from smooth, fluid gradients to gritty, distressed surfaces. The lighting should have dynamic contrasts, with soft glows merging into intense bursts of light, symbolizing the merging of calm and chaos. Style: surreal and atmospheric with a dreamlike quality, blending soft gradients with sharp, glitchy distortions and industrial textures. No text, faces, or human figures should appear.

        **Now, the new input:**  
        Artists: ${artistNames.join(', ')}
    `;
    return await fetchTextToImageAPI(prompt);
};

const fetchTextToImageAPI = async (prompt) => {
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openrouter_api_key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "deepseek/deepseek-chat-v3-0324:free",
                messages: [{ role: "user", content: [{ type: "text", text: `Generate an image for the following prompt: ${prompt}` }] }]
            })
        });

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Image API Error:', error.message);
        throw new Error('Image generation failed');
    }
};

// Early Access Route
app.post('/earlyaccess', async (req, res) => {
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: 'Email is required' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email format' });

    try {
        const count = await EarlyAccess.countDocuments();
        if (count >= 100) return res.status(403).json({ error: 'Early access is full' });

        const existing = await EarlyAccess.findOne({ spotify_email: email });
        if (existing) return res.status(409).json({ error: 'Email already registered' });

        const newUser = new EarlyAccess({ spotify_email: email });
        await newUser.save();
        return res.status(201).json({ message: 'Early access granted', user: newUser });
    } catch (error) {
        console.error('Early Access Error:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/', (req, res) => {
    res.send('Server running. Use /login to start.');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
