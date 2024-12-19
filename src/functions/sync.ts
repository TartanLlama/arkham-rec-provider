import { app } from '@azure/functions';
import { syncData } from '../sync';

app.timer('sync', {
  runOnStartup: true,
  useMonitor: false,
  schedule: '0 0 0 * * *',
  handler: async (timerBinding, context) => {
    await syncData(false);
  },
});