import { IclassClient, reasonError } from "./client";
import {
  IclassAuthorizationRepository,
  type AuthorizationRow,
} from "./repository";
import { courseTime, shanghaiDate } from "./schema";

export class IclassService {
  readonly repository: IclassAuthorizationRepository;
  private readonly client: IclassClient;
  constructor(
    env: Env,
    private readonly now: () => Date,
  ) {
    this.repository = new IclassAuthorizationRepository(env.API_PLATFORM_KV);
    this.client = new IclassClient(env, now);
  }
  async authorization(userId: string) {
    const row = await this.repository.get(userId);
    return { authorized: !!row, authorizedAt: row?.authorized_at ?? null };
  }
  async authorize(userId: string, loginName: string) {
    await this.client.schedule(loginName, shanghaiDate(this.now()));
    await this.repository.put(userId, loginName, this.now());
    return this.authorization(userId);
  }
  private async credentials(userId: string) {
    const row = await this.repository.get(userId);
    if (!row)
      throw reasonError(
        "ICLASS_AUTHORIZATION_REQUIRED",
        "请在 App 内完成授权",
        403,
      );
    return row;
  }
  private async unchanged(userId: string, expected: AuthorizationRow) {
    const current = await this.repository.get(userId);
    if (
      current?.login_name !== expected.login_name ||
      current?.authorized_at !== expected.authorized_at
    )
      throw reasonError(
        "ICLASS_AUTHORIZATION_CHANGED",
        "授权已变化，请刷新后重试",
        403,
      );
  }
  async schedules(userId: string, date: string) {
    const row = await this.credentials(userId);
    const items = await this.client.schedule(row.login_name, date);
    await this.unchanged(userId, row);
    return { date, serverTime: this.now().toISOString(), items };
  }
  async sign(
    userId: string,
    input: {
      date: string;
      courseScheduleId: string;
      allowOutsideWindow: boolean;
    },
  ) {
    const lease = await this.repository.acquire(userId, this.now());
    if (!lease)
      throw reasonError("SIGN_IN_PROGRESS", "正在签到，请稍后刷新课表", 409);
    try {
      const row = await this.credentials(userId);
      const courses = await this.client.schedule(row.login_name, input.date);
      const course = courses.find(
        (item) => item.courseScheduleId === input.courseScheduleId,
      );
      if (!course)
        throw reasonError("COURSE_NOT_FOUND", "该课程不在当前账号课表中", 404);
      await this.unchanged(userId, row);
      if (course.signStatus === 1)
        return {
          courseScheduleId: course.courseScheduleId,
          alreadySigned: true,
        };
      const begin = courseTime(course.classBeginTime),
        end = courseTime(course.classEndTime);
      if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin)
        throw reasonError(
          "ICLASS_INVALID_RESPONSE",
          "课程时间无效，请刷新课表",
        );
      const now = this.now().getTime();
      if (!input.allowOutsideWindow && (now < begin - 600_000 || now > end))
        throw reasonError(
          "SIGN_WINDOW_CONFIRMATION_REQUIRED",
          "当前不在签到时间内，是否仍要尝试？",
          409,
        );
      return {
        ...(await this.client.sign(row.login_name, course.courseScheduleId)),
        alreadySigned: false,
      };
    } finally {
      await this.repository.release(userId, lease);
    }
  }
}
