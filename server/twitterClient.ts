import crypto from 'crypto';
import { fetch } from 'undici';

interface TwitterConfig {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

interface TweetResponse {
  data?: {
    id: string;
    text: string;
  };
  errors?: Array<{ message: string; code: number }>;
}

function getConfig(): TwitterConfig | null {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;
  
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    return null;
  }
  
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  
  const signatureBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams)
  ].join('&');
  
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  
  const hmac = crypto.createHmac('sha1', signingKey);
  hmac.update(signatureBase);
  return hmac.digest('base64');
}

function generateOAuthHeader(
  method: string,
  url: string,
  config: TwitterConfig
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: config.accessToken,
    oauth_version: '1.0'
  };
  
  const signature = generateOAuthSignature(
    method,
    url,
    oauthParams,
    config.apiSecret,
    config.accessTokenSecret
  );
  
  oauthParams.oauth_signature = signature;
  
  const headerParams = Object.keys(oauthParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
    .join(', ');
  
  return `OAuth ${headerParams}`;
}

export async function postTweet(text: string): Promise<{ success: boolean; tweetId?: string; tweetUrl?: string; error?: string }> {
  const config = getConfig();
  
  if (!config) {
    return { 
      success: false, 
      error: 'Twitter API credentials not configured. Please add TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, and TWITTER_ACCESS_TOKEN_SECRET.' 
    };
  }
  
  const url = 'https://api.twitter.com/2/tweets';
  
  try {
    const authHeader = generateOAuthHeader('POST', url, config);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    
    const data = await response.json() as TweetResponse;
    
    if (!response.ok) {
      console.error('[Twitter] API error:', data);
      return { 
        success: false, 
        error: data.errors?.[0]?.message || `HTTP ${response.status}` 
      };
    }
    
    if (data.data?.id) {
      const tweetUrl = `https://x.com/i/status/${data.data.id}`;
      console.log(`[Twitter] Tweet posted successfully: ${tweetUrl}`);
      return { 
        success: true, 
        tweetId: data.data.id,
        tweetUrl 
      };
    }
    
    return { success: false, error: 'Unknown error - no tweet ID returned' };
  } catch (error: any) {
    console.error('[Twitter] Failed to post tweet:', error);
    return { success: false, error: error.message || 'Failed to post tweet' };
  }
}

export function isTwitterConfigured(): boolean {
  return getConfig() !== null;
}

export function generateArticleTweet(title: string, summary: string, articleUrl: string): string {
  const maxLength = 280;
  const urlLength = 23;
  const availableLength = maxLength - urlLength - 3;
  
  let tweetText = title;
  if (tweetText.length < availableLength - 50 && summary) {
    const remainingSpace = availableLength - tweetText.length - 3;
    if (remainingSpace > 30) {
      const shortSummary = summary.length > remainingSpace 
        ? summary.substring(0, remainingSpace - 3) + '...'
        : summary;
      tweetText = `${title}\n\n${shortSummary}`;
    }
  }
  
  if (tweetText.length > availableLength) {
    tweetText = tweetText.substring(0, availableLength - 3) + '...';
  }
  
  return `${tweetText}\n\n${articleUrl}`;
}
