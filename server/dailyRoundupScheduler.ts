import { storage } from "./storage";
import { generateDailyRoundup } from "./articleGenerator";
import { postTweet, generateArticleTweet, isTwitterConfigured } from "./twitterClient";

let schedulerInterval: NodeJS.Timeout | null = null;
let lastCheckDate: string | null = null;

function getDateInTimezone(timezone: string): Date {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(now);
  
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';
  
  return new Date(
    parseInt(getPart('year')),
    parseInt(getPart('month')) - 1,
    parseInt(getPart('day')),
    parseInt(getPart('hour')),
    parseInt(getPart('minute'))
  );
}

async function checkAndGenerateRoundup(): Promise<void> {
  try {
    const settings = await storage.getDailyRoundupSettings();
    
    if (!settings || !settings.enabled) {
      return;
    }
    
    const localTime = getDateInTimezone(settings.timezone);
    const currentHour = localTime.getHours();
    const today = localTime.toDateString();
    
    // Check if we're in the scheduled hour
    if (currentHour !== settings.scheduledHour) {
      return;
    }
    
    // Check if we already generated today
    if (lastCheckDate === today) {
      return;
    }
    
    // Also check database for last generation (use the persisted timestamp)
    if (settings.lastGeneratedAt) {
      // Convert last generated timestamp to the scheduled timezone for comparison
      const lastGenFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const lastGenDateStr = lastGenFormatter.format(new Date(settings.lastGeneratedAt));
      const todayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const todayDateStr = todayFormatter.format(new Date());
      
      if (lastGenDateStr === todayDateStr) {
        lastCheckDate = today;
        console.log(`[DailyRoundupScheduler] Already generated today (${lastGenDateStr}), skipping`);
        return;
      }
    }
    
    console.log(`[DailyRoundupScheduler] Starting scheduled roundup generation for ${today}`);
    lastCheckDate = today;
    
    const result = await generateDailyRoundup();
    await storage.updateLastGeneratedAt();
    
    console.log(`[DailyRoundupScheduler] Generated: ${result.title}`);
    
    // Auto-publish if enabled
    if (settings.autoPublish) {
      const published = await storage.publishArticle(result.id);
      console.log(`[DailyRoundupScheduler] Auto-published article: ${result.id}`);
      
      // Auto-tweet if enabled
      if (settings.autoTweet && published) {
        if (!isTwitterConfigured()) {
          console.log(`[DailyRoundupScheduler] Twitter not configured, skipping tweet`);
        } else {
          try {
            const articleUrl = `https://f1predict.replit.app/news/${published.slug}`;
            const tweetText = generateArticleTweet(published.title, published.summary || "", articleUrl);
            const tweetResult = await postTweet(tweetText);
            if (tweetResult.success) {
              console.log(`[DailyRoundupScheduler] Posted to Twitter: ${tweetResult.tweetUrl}`);
            } else {
              console.log(`[DailyRoundupScheduler] Twitter post failed: ${tweetResult.error}`);
            }
          } catch (tweetError) {
            console.error(`[DailyRoundupScheduler] Twitter post error:`, tweetError);
          }
        }
      }
    }
  } catch (error) {
    console.error("[DailyRoundupScheduler] Error:", error);
  }
}

export function startDailyRoundupScheduler(): void {
  if (schedulerInterval) {
    console.log("[DailyRoundupScheduler] Already running");
    return;
  }
  
  console.log("[DailyRoundupScheduler] Starting scheduler (checks every 5 minutes)");
  
  // Check immediately on start
  checkAndGenerateRoundup();
  
  // Then check every 5 minutes
  schedulerInterval = setInterval(checkAndGenerateRoundup, 5 * 60 * 1000);
}

export function stopDailyRoundupScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[DailyRoundupScheduler] Stopped");
  }
}
