const fs = require('fs');
const path = require('path');

const USERNAME = process.env.TWITTER_USERNAME || 'PeriodistaRufus';
const INPUT = process.env.WAYBACK_INPUT || path.join(__dirname, '..', 'periodistarufus_wayback_combined.json');
const OUTPUT = process.env.TWEETS_OUTPUT || path.join(__dirname, '..', 'data', 'tweets.json');

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function tweetText(tweet) {
  if (tweet?.note_tweet?.text && tweet.note_tweet.text.length > (tweet?.full_text || tweet?.text || '').length) {
    return tweet.note_tweet.text;
  }
  return tweet?.full_text || tweet?.text || '';
}

function referencedTweetText(tweet) {
  if (tweet?.note_tweet?.text && tweet.note_tweet.text.length > (tweet?.text || tweet?.full_text || '').length) {
    return tweet.note_tweet.text;
  }
  return tweet?.text || tweet?.full_text || '';
}

function findMainTweet(body, fallbackId) {
  if (!body || typeof body !== 'object') return null;
  if (body.data?.id || body.data?.text) return body.data;
  if (Array.isArray(body.data)) return body.data.find((tweet) => String(tweet.id) === String(fallbackId)) || body.data[0];
  if (body.id || body.text) return body;

  const globalTweet = body.globalObjects?.tweets?.[fallbackId] || first(Object.values(body.globalObjects?.tweets || {}));
  if (globalTweet) return globalTweet;

  return null;
}

function usersById(body) {
  const map = new Map();
  for (const user of body?.includes?.users || []) {
    if (user?.id) map.set(String(user.id), user);
    if (user?.id_str) map.set(String(user.id_str), user);
  }
  for (const user of Object.values(body?.globalObjects?.users || {})) {
    if (user?.id) map.set(String(user.id), user);
    if (user?.id_str) map.set(String(user.id_str), user);
  }
  return map;
}

function tweetsById(body) {
  const map = new Map();
  for (const tweet of body?.includes?.tweets || []) {
    if (tweet?.id) map.set(String(tweet.id), tweet);
    if (tweet?.id_str) map.set(String(tweet.id_str), tweet);
  }
  for (const tweet of Object.values(body?.globalObjects?.tweets || {})) {
    if (tweet?.id) map.set(String(tweet.id), tweet);
    if (tweet?.id_str) map.set(String(tweet.id_str), tweet);
  }
  return map;
}

function normalizeMetrics(tweet) {
  const metrics = tweet?.public_metrics || {};
  return {
    retweet_count: Number(metrics.retweet_count || tweet?.retweet_count || 0),
    reply_count: Number(metrics.reply_count || tweet?.reply_count || 0),
    like_count: Number(metrics.like_count || tweet?.favorite_count || 0),
    quote_count: Number(metrics.quote_count || 0),
    bookmark_count: Number(metrics.bookmark_count || 0),
    impression_count: Number(metrics.impression_count || 0),
  };
}

function normalizeUrls(tweet) {
  const urls = tweet?.entities?.urls || [];
  const seen = new Set();
  return urls
    .filter((url) => {
      const key = url.url || url.short_url || url.expanded_url;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((url) => ({
      short_url: url.url || url.short_url || null,
      expanded_url: url.expanded_url || url.expanded || null,
      display_url: url.display_url || url.display || null,
      title: url.title || null,
      description: url.description || null,
      media_key: url.media_key || null,
    }));
}

function normalizeMentions(tweet) {
  return (tweet?.entities?.mentions || []).map((mention) => ({
    username: mention.username || mention.screen_name || '',
    id: mention.id || mention.id_str || '',
  }));
}

function normalizeAnnotations(tweet) {
  return (tweet?.entities?.annotations || []).map((annotation) => ({
    text: annotation.normalized_text || annotation.text || '',
    type: annotation.type || '',
    p: annotation.probability ?? annotation.p ?? null,
  }));
}

function normalizeContextTags(tweet) {
  return (tweet?.context_annotations || []).map((context) => ({
    domain: context.domain?.name || context.domain || '',
    name: context.entity?.name || context.entity || '',
  }));
}

function normalizeReferenced(tweet, body) {
  const relatedTweets = tweetsById(body);
  const relatedUsers = usersById(body);
  return (tweet?.referenced_tweets || []).map((reference) => {
    const related = relatedTweets.get(String(reference.id));
    const author = related ? relatedUsers.get(String(related.author_id || related.user_id || related.user_id_str)) : null;
    return {
      type: reference.type,
      id: String(reference.id),
      ...(related ? { text: referencedTweetText(related) } : {}),
      ...(related ? { urls: normalizeUrls(related) } : {}),
      ...(related ? { context_tags: normalizeContextTags(related) } : {}),
      ...(related ? { public_metrics: normalizeMetrics(related) } : {}),
      ...(author ? {
        author_username: author.username || author.screen_name || '',
        author_name: author.name || '',
      } : {}),
    };
  });
}

function normalizeTweet(id, item) {
  const body = item.body;
  const tweet = findMainTweet(body, id);
  if (!tweet?.id && !tweet?.id_str) return null;

  const users = usersById(body);
  const author = users.get(String(tweet.author_id || tweet.user_id || tweet.user_id_str)) || first([...users.values()]) || {};
  const tweetId = String(tweet.id || tweet.id_str || id);
  const original = item.original || `https://twitter.com/${USERNAME}/status/${tweetId}`;

  const noteTweetText = tweet?.note_tweet?.text;
  const mainText = tweetText(tweet);
  const hasNoteTweet = noteTweetText && noteTweetText.length > (tweet?.text || '').length;

  return {
    id: tweetId,
    created_at: tweet.created_at || '',
    lang: tweet.lang || '',
    text: mainText,
    ...(hasNoteTweet ? { note_tweet_text: noteTweetText } : {}),
    author_id: String(tweet.author_id || tweet.user_id || tweet.user_id_str || author.id || author.id_str || ''),
    author_username: author.username || author.screen_name || USERNAME,
    author_name: author.name || 'Rufus',
    author_profile_image_url: author.profile_image_url || author.profile_image_url_https || null,
    ...(author.description ? { author_description: author.description } : {}),
    ...(author.verified != null ? { author_verified: Boolean(author.verified) } : {}),
    ...(author.public_metrics ? { author_public_metrics: { followers_count: author.public_metrics.followers_count || 0, following_count: author.public_metrics.following_count || 0, tweet_count: author.public_metrics.tweet_count || 0 } } : {}),
    conversation_id: String(tweet.conversation_id || tweet.conversation_id_str || tweetId),
    possibly_sensitive: Boolean(tweet.possibly_sensitive),
    public_metrics: normalizeMetrics(tweet),
    urls: normalizeUrls(tweet),
    mentions: normalizeMentions(tweet),
    hashtags: (tweet.entities?.hashtags || []).map((tag) => tag.tag || tag.text || '').filter(Boolean),
    cashtags: (tweet.entities?.cashtags || []).map((tag) => tag.tag || tag.text || '').filter(Boolean),
    annotations: normalizeAnnotations(tweet),
    context_tags: normalizeContextTags(tweet),
    referenced: normalizeReferenced(tweet, body),
    wayback_ts: item.ts || '',
    wayback_url: `${'https://web.archive.org/web'}/${item.ts || ''}/${original}`,
    twitter_url: `https://twitter.com/${USERNAME}/status/${tweetId}`,
  };
}

function main() {
  const raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const tweets = Object.entries(raw.items || {})
    .map(([id, item]) => (item?.status === 200 && item.body ? normalizeTweet(id, item) : null))
    .filter(Boolean)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

  const ids = new Set(tweets.map((tweet) => tweet.id));
  if (ids.size !== tweets.length) {
    throw new Error(`Duplicate tweet IDs detected: ${tweets.length - ids.size}`);
  }
  if (!tweets.length) {
    throw new Error(`No tweets could be built from ${INPUT}`);
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(tweets)}\n`);
  console.log(`Saved ${tweets.length} tweets to ${OUTPUT}`);
}

main();