import axios from 'axios';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

class VirtualClock {
  private server: Dayjs | null = null;
  private client: Dayjs | null = null;

  constructor() {
    this.fetchServerTime();
    setInterval(() => this.fetchServerTime(), 60_000);
  }

  getCurrentTime = () => {
    if (this.server && this.client) {
      const now = dayjs.utc();
      const nowClientDiff = now.diff(this.client, 'milliseconds');
      return this.server.add(nowClientDiff, 'milliseconds').valueOf();
    }

    return dayjs.utc().valueOf();
  };

  private fetchServerTime = async () => {
    const { data } = await axios.get(
      'http://worldtimeapi.org/api/timezone/etc/utc'
    );

    this.server = dayjs.utc(data.utc_datetime);
    this.client = dayjs.utc();
  };
}

export const virtualClock = new VirtualClock();
