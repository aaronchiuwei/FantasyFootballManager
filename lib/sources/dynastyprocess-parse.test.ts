import { describe, expect, it } from "vitest";

import { parseDynastyProcessIds } from "./dynastyprocess-parse";

const HEADER =
  "mfl_id,sleeper_id,yahoo_id,espn_id,name,merge_name,position,team,birthdate";

describe("parseDynastyProcessIds", () => {
  it("keeps rows that bridge a sleeper_id to a provider id", () => {
    const csv = [
      HEADER,
      "1,100,200,300,Complete Row,complete row,WR,KC,2000-01-01",
      "2,101,NA,301,No Yahoo,no yahoo,RB,SF,2000-01-01",
      "3,NA,201,302,No Sleeper,no sleeper,TE,DAL,2000-01-01",
      "4,102,NA,NA,No Provider,no provider,QB,BUF,2000-01-01",
      "5,,,,All Blank,all blank,QB,BUF,2000-01-01",
    ].join("\n");

    const rows = parseDynastyProcessIds(csv);
    expect(rows.map((row) => row.sleeperId)).toEqual(["100", "101"]);
    expect(rows[0]).toMatchObject({
      sleeperId: "100",
      yahooId: "200",
      espnId: "300",
      mergeName: "complete row",
      position: "WR",
      team: "KC",
    });
    // An ESPN-only row is still a bridge — it just is not a Yahoo one.
    expect(rows[1]).toMatchObject({ yahooId: null, espnId: "301" });
  });

  it("treats NA as null for team", () => {
    const csv = [
      HEADER,
      "1,100,200,300,Free Agent,free agent,WR,NA,2000-01-01",
    ].join("\n");
    expect(parseDynastyProcessIds(csv)[0].team).toBeNull();
  });
});
