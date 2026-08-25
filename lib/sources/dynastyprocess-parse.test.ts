import { describe, expect, it } from "vitest";

import { parseDynastyProcessIds } from "./dynastyprocess-parse";

const HEADER =
  "mfl_id,sleeper_id,yahoo_id,name,merge_name,position,team,birthdate";

describe("parseDynastyProcessIds", () => {
  it("keeps only rows with both a sleeper_id and a yahoo_id", () => {
    const csv = [
      HEADER,
      "1,100,200,Complete Row,complete row,WR,KC,2000-01-01",
      "2,101,NA,No Yahoo,no yahoo,RB,SF,2000-01-01",
      "3,NA,201,No Sleeper,no sleeper,TE,DAL,2000-01-01",
      "4,,,Both Blank,both blank,QB,BUF,2000-01-01",
    ].join("\n");

    const rows = parseDynastyProcessIds(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sleeperId: "100",
      yahooId: "200",
      mergeName: "complete row",
      position: "WR",
      team: "KC",
    });
  });

  it("treats NA as null for team", () => {
    const csv = [
      HEADER,
      "1,100,200,Free Agent,free agent,WR,NA,2000-01-01",
    ].join("\n");
    expect(parseDynastyProcessIds(csv)[0].team).toBeNull();
  });
});
