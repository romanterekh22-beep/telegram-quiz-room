# Quiz Room

A small Node.js server and browser client for a live multiplayer trivia room.

## Run locally

```powershell
node quiz-server.js
```

Open http://localhost:3000. Create a room in one browser window and join it from another using the room code. The game supports up to eight players.

## Deploy on Render

1. Upload all files in this folder to the root of a GitHub repository.
2. In Render, create a **Web Service** from that repository.
3. Set **Runtime** to Node, **Build Command** to `echo no build step`, and **Start Command** to `node quiz-server.js`.
4. Choose a plan and deploy. The server reads Render's `PORT` variable and binds to `0.0.0.0`.
5. Open the generated HTTPS URL to use the game.

Rooms and scores currently live in server memory. Restarting or redeploying clears active rooms. The free Render plan can sleep after inactivity, so it is for trials rather than uninterrupted play.

## Telegram Mini App

After deployment, configure the bot's Mini App URL in @BotFather to the public HTTPS URL. The current prototype does not yet validate Telegram `initData`; add that before relying on Telegram identity or competitive scores.
