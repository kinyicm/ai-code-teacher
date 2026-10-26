import { NextResponse, connection } from "next/server";

/**
 * 运行状态探测：供前端在首屏判断「服务端是否已配置模型密钥」，
 * 从而在用户点发送之前就给出配置指引，而不是等他撞上 400。
 *
 * 只返回布尔值与模型名，不返回任何密钥片段。
 */
export async function GET() {
  // 必须按请求实时计算：环境变量可能在构建之后才注入（例如部署平台控制台里配置），
  // 若被静态化，keyConfigured 会在构建期被烘焙成一个固定值，
  // 导致「配好 Key 之后横幅仍显示未配置」或反过来「缺 Key 却不提示」。
  await connection();

  const serverKey = (process.env.ZHIPU_API_KEY ?? "").trim();
  const model = (process.env.LLM_MODEL ?? "").trim() || "glm-4-flash";
  const baseUrlConfigured = Boolean((process.env.LLM_BASE_URL ?? "").trim());

  return NextResponse.json(
    {
      ok: true,
      // 服务端是否持有可用密钥；false 时前端应提示用户配置
      keyConfigured: serverKey.length > 0,
      // 当前生效的默认模型名，便于界面显示与排查
      model,
      // 是否通过环境变量覆盖了接口地址（换服务商时用于显示来源）
      baseUrlConfigured,
    },
    {
      headers: { "cache-control": "no-store" },
    },
  );
}
