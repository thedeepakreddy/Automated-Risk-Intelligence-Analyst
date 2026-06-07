import cron from 'node-cron';
import { runIngestionCycle } from './ingestion.js';
import { generateDailyReport } from './reporter.js';

export function startCronJobs() {
  // Run every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log('[CRON] Running 30-minute data ingestion cycle...');
    try {
      await runIngestionCycle();
    } catch (e) {
      console.error('[CRON] Ingestion cycle failed:', e);
    }
  });

  // Run every day at 8:00 AM
  cron.schedule('0 8 * * *', async () => {
    console.log('[CRON] Running daily AI report generation...');
    try {
      await generateDailyReport();
    } catch (e) {
      console.error('[CRON] Report generation failed:', e);
    }
  });

  console.log('[CRON] Jobs scheduled successfully.');
  
  // Optional: Run ingestion once on startup immediately (disabled by default to spare API limits)
  setTimeout(() => runIngestionCycle(), 5000);
}
