import { Command } from "commander";
import { output } from "../../formatters/table.js";
import type { SkmClientInfo } from "../../services/skm/types.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { formatCell, parseMacAddressOption, resolveSkmClient, type SkmCommandOptions, withSkmOptions } from "./helpers.js";

export const confirmCommand = withSkmOptions(
  new Command("confirm").description("SKM 서버가 본 클라이언트 IP, MAC 헤더와 인증서 사용 여부를 조회한다"),
).action(async (_opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SkmCommandOptions>();
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  startSpinner("SKM 클라이언트 정보 조회 중...");
  let info: SkmClientInfo;
  try {
    info = await client.confirm();
  } catch (err) {
    stopSpinner(false);
    throw err;
  }
  stopSpinner(true);

  output(opts, {
    headers: ["field", "value"],
    rows: [
      ["clientIp", formatCell(info.clientIp)],
      ["clientMacHeader", formatCell(info.clientMacHeader)],
      ["clientSentCertificate", formatCell(info.clientSentCertificate)],
    ],
    raw: info,
    ids: [formatCell(info.clientIp)],
  });
});
