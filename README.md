# Deploy this folder to Vercel

```bash
# one-time
npm i -g vercel

# from inside this folder
cd vercel_deploy
vercel            # creates a preview deploy and asks a few questions
vercel --prod     # promotes the latest deploy to your production URL
```

That's it — `index.html` is the only thing being served.
