const express = require('express');
const querystring = require('querystring');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const db = require('./db'); // Import the database connection and User model
const ratelimiter = require('express-rate-limit'); // Import rate limiter
const { User,EarlyAccess } = db; // Destructure User from db

dotenv.config(); // Load environment variables from .env file

const app = express();
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(ratelimiter({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: 'Too many requests, please try again later.',
})); 


const client_id = process.env.CLIENT_ID; 
const client_secret = process.env.CLIENT_SECRET; 
const openrouter_api_key = process.env.OPENROUTER_API_KEY; 
const frontend_url = 'https://spot-fro.vercel.app/'; 
const redirect_uri = 'http://127.0.0.1:5000/callback';

const generateRandomString = (length) => {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

app.get('/login', (req, res) => {
    const state = generateRandomString(16);
    const scope = 'user-read-private user-read-email user-top-read';

    res.redirect(
        'https://accounts.spotify.com/authorize?' +
            querystring.stringify({
                response_type: 'code',
                client_id: client_id,
                scope: scope,
                redirect_uri: redirect_uri,
                state: state,
            })
    );
});

app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;
    
    if (!state) {
        res.redirect(
            `${frontend_url}/#` +
                querystring.stringify({
                    error: 'state_mismatch',
                })
        );
    } else {
        try {
            const authOptions = {
                url: 'https://accounts.spotify.com/api/token',
                method: 'post',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization:
                        'Basic ' +
                        Buffer.from(client_id + ':' + client_secret).toString('base64'),
                },
                data: querystring.stringify({
                    code: code,
                    redirect_uri: redirect_uri,
                    grant_type: 'authorization_code',
                }),
            };

            const response = await axios(authOptions);
            const accessToken = response.data.access_token;
            const refreshToken = response.data.refresh_token;

            // Fetch user profile to get the Spotify user ID
            const userProfileResponse = await axios.get('https://api.spotify.com/v1/me', {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            const spotifyId = userProfileResponse.data.id; // Make sure to access the id from data property
            console.log('Spotify ID:', spotifyId); // Log for debugging
            
          
            let user = await User.findOne({
                spotify_id: spotifyId,
            })
            if (!user) {
                // If user doesn't exist, create a new record
                user = new User({
                    spotify_id: spotifyId,
                    access_token: accessToken,
                    refresh_token: refreshToken,
                });
                await user.save();
            } else {
                // If user exists, update access token
                user.access_token = accessToken;
                user.refresh_token = refreshToken;
                await user.save();
            }

            res.redirect(
                `${frontend_url}/home?` +
                querystring.stringify({
                    user_id: spotifyId,
                    auth_success: true
                })
            );
        } catch (error) {
            console.error('Error fetching access token:', error.message);
            res.redirect(
                `${frontend_url}/home?` +
                querystring.stringify({
                    error: 'authentication_error'
                })
            );
        }
    }
});


app.post('/get_access_token', async (req, res) => {
    const { user_id } = req.body;
    
    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    
    try {
        const user = await User.findOne({ spotify_id: user_id });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        return res.json({ 
            access_token: user.access_token 
        });
    } catch (error) {
        console.error('Error fetching access token:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/get_user_top_tracks', async (req, res) => {
    const { user_id } = req.query;
    
    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    
    try {
        // Get access token from database
        const user = await User.findOne({ spotify_id: user_id });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const access_token = user.access_token;
        
        // Use the access token to fetch user's top artists
        const response = await axios.get('https://api.spotify.com/v1/me/top/artists', {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });

        const allArtists = response.data.items.map((artist) => artist.name);
        const artists = allArtists.slice(0, 2); // Get the top 2 artists
        console.log('Top artists:', artists);  // Log for debugging

        // Generate the prompt based on the artists
        const prompt = await generateTextToImagePrompt(artists);
        res.json({ artists, prompt });
    } catch (error) {
        console.error('Error fetching user top tracks:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const generateTextToImagePrompt = async (artistNames) => {
    // Constructing a dynamic prompt based on the artists' names
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

    // Call the text-to-image API with the generated prompt
    return await fetchTextToImageAPI(prompt);
};

const fetchTextToImageAPI = async (prompt) => {
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + openrouter_api_key,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "deepseek/deepseek-chat-v3-0324:free",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: `Generate an image for the following prompt: ${prompt}`,
                            }
                        ]
                    }
                ]
            })
        });

        const data = await response.json();
        console.log('Image generation response:', data); // Log the response for debugging
        return data.choices[0].message.content; // Assuming the image URL is in the content field
    } catch (error) {
        console.error('Error generating image:', error.message);
        throw new Error('Image generation failed');
    }
};

const earlyaccess = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    try {
        const count = await EarlyAccess.countDocuments();

        if (count >= 100) {
            return res.status(403).json({ error: 'Early access is full' });
        }

        const existing = await EarlyAccess.findOne({ spotify_email: email });

        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const newUser = new EarlyAccess({ spotify_email: email });
        await newUser.save();

        return res.status(201).json({ message: 'Early access granted', user: newUser });
    } catch (error) {
        console.error('Error granting early access:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

app.post('/earlyaccess', earlyaccess);

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(5000, () => {
    console.log('Server is running on http://127.0.0.1:5000');
});