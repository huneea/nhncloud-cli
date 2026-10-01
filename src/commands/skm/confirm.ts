import { Command } from "commander";
import { output } from "../../formatters/table.js";
import { formatCell, parseMacAddressOption, resolveSkmClient, type SkmCommandOptions, withSkmOptions, withSkmSpinner } from "./helpers.js";

export const confirmCommand = withSkmOptions(
  new Command("confirm").description("SKM 서버가 본 클라이언트 IP, MAC 헤더와 인증서 사용 여부를 조회한다"),
).action(async (_opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SkmCommandOptions>();
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const info = await withSkmSpinner("SKM 클라이언트 정보 조회 중...", () => client.confirm());

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
