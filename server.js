const express = require('express');
const querystring = require('querystring');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const { User } = require('./db'); // Import the User model

dotenv.config();

const app = express();
app.use(cors()); // Enable CORS for all routes

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const openrouter_api_key = process.env.OPENROUTER_API_KEY;
const redirect_uri = 'https://spot-fro-5ex7.vercel.app/home'; // Update this as needed

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
            '/#' +
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
            const refreshToken = response.data.refresh_token; // Optional: Store refresh token if you want to refresh access tokens

            // Store the token in MongoDB for future use
            const spotifyId = response.data.id; // Assuming Spotify API provides user ID in the response

            // Check if user exists
            let user = await User.findOne({ spotify_id: spotifyId });
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
                await user.save();
            }

            res.send({
                access_token: accessToken,
            });
        } catch (error) {
            console.error('Error fetching access token:', error.message);
            res.status(500).send('Internal Server Error');
        }
    }
});

app.get('/get_user_top_tracks', async (req, res) => {
    const access_token = req.query.access_token;

    try {
        const response = await axios.get('https://api.spotify.com/v1/me/top/artists', {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });

        const allArtists = response.data.items.map((artist) => artist.name);
        const artists = allArtists.slice(0, 2);

        // Generate the prompt based on the artist
        const prompt = await generateTextToImagePrompt(artists);
        res.send({ artists, prompt });
    } catch (error) {
        console.error('Error fetching user top tracks:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

const generateTextToImagePrompt = async (artistNames) => {
    const prompt = `
        You are a prompt engineer for a text-to-image model. 
        Given a list of music artists, generate a highly detailed and cohesive album-poster style image that blends their aesthetics into one harmonious scene.

        **Input Example:**  
        Artist: Tame Impala, The Prodigy, Nirvana, Bon Iver

        **Output Example:**  
        A surreal and atmospheric poster blending the styles of Tame Impala, The Prodigy, Nirvana, and Bon Iver into a cohesive visual masterpiece...
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
                "Authorization": "Bearer " + openrouter_api_key,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "deepseek/deepseek-chat-v3-0324:free",
                messages: [
                    {
                        role: "user",
                        content: [{ type: "text", text: `Generate an image for the following prompt: ${prompt}` }],
                    }
                ]
            })
        });

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Error generating image:', error.message);
        throw new Error('Image generation failed');
    }
};

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(5000, () => {
    console.log('Server is running on http://127.0.0.1:5000');
});
