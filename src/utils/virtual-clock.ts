import axios from 'axios';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

class VirtualClock {
  started = false;

  private server: Dayjs | null = null;
  private client: Dayjs | null = null;

  start = async () => {
    if (!this.started) {
      this.started = true;

      await this.fetchServerTime();
      setInterval(() => this.fetchServerTime(), 60_000);
    }
  };

  getCurrentTime = () => {
    if (this.server && this.client) {
      const now = dayjs.utc();
      const nowClientDiff = now.diff(this.client, 'milliseconds');
      return this.server.add(nowClientDiff, 'milliseconds').valueOf();
    }

    return dayjs.utc().valueOf();
  };

  private fetchServerTime = async () => {
    if (typeof window === 'undefined') {
      // assume we are running onto a server
      // this should have a better time sync
      this.server = dayjs.utc();
      this.client = dayjs.utc();

      return;
    }

    try {
      const { data } = await axios.get(
        'https://worldtimeapi.org/api/timezone/etc/utc',
        { timeout: 5000 }
      );

      this.server = dayjs.utc(data.utc_datetime);
      this.client = dayjs.utc();
    } catch {
      // fallback to tuleep.trade server time
      // we don't really want to use this API as its not meant for this
      try {
        const {
          data: { time },
        } = await axios.get('https://tuleep.trade/api/time');

        this.server = dayjs.utc(time);
        this.client = dayjs.utc();
      } catch {
        // fallback to local time if all else fails
        this.server = dayjs.utc();
        this.client = dayjs.utc();
      }
    }
  };
}

export const virtualClock = new VirtualClock();
