declare module "google-trends-api" {
  interface TrendsOptions {
    keyword: string | string[];
    geo?: string;
    startTime?: Date;
    endTime?: Date;
    resolution?: string;
    category?: number;
    property?: string;
    hl?: string;
    timezone?: number;
  }

  function interestOverTime(options: TrendsOptions): Promise<string>;
  function interestByRegion(options: TrendsOptions): Promise<string>;
  function relatedQueries(options: TrendsOptions): Promise<string>;
  function relatedTopics(options: TrendsOptions): Promise<string>;
  function dailyTrends(options: { geo?: string; trendDate?: Date; hl?: string }): Promise<string>;
  function realTimeTrends(options: { geo?: string; category?: string; hl?: string }): Promise<string>;

  export default {
    interestOverTime,
    interestByRegion,
    relatedQueries,
    relatedTopics,
    dailyTrends,
    realTimeTrends,
  };
}
