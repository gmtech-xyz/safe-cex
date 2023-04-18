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

      await this.syncClientServerTime();
      setInterval(() => this.syncClientServerTime(), 60_000);
    }
  };

  getCurrentTime = () => {
    if (this.server && this.client) {
      const now = dayjs.utc();
      const nowClientDiff = now.diff(this.client, 'milliseconds');
      return this.server.add(nowClientDiff, 'milliseconds');
    }

    return dayjs.utc();
  };

  private syncClientServerTime = async () => {
    if (typeof window === 'undefined') {
      // assume we are running onto a server
      // this should have a better time sync
      this.server = null;
      this.client = null;

      return;
    }

    this.server = await this.fetchServerTime();
    this.client = dayjs.utc();

    // if the difference is less than 5 seconds
    // assume the time is correct
    if (Math.abs(this.server.diff(this.client, 'milliseconds')) < 1000) {
      this.server = null;
      this.client = null;
    }
  };

  private fetchServerTime = async () => {
    try {
      const { data } = await axios.get(
        'https://worldtimeapi.org/api/timezone/etc/utc',
        { timeout: 5000 }
      );
      return dayjs.utc(data.utc_datetime);
    } catch {
      // ignore
    }

    try {
      const {
        data: { time },
      } = await axios.get('https://tuleep.trade/api/time', { timeout: 5000 });
      return dayjs.utc(time);
    } catch {
      // ignore
    }

    return dayjs.utc();
  };
}

export const virtualClock = new VirtualClock();
