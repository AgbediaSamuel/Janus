import { Actor, Persisted } from "terse-sdk/actor";
import {
  commitCaseState,
  emptyCaseState,
  type CaseActorState,
  type CaseCommit,
  type CaseCommitResult,
} from "../../case-state";

export class SupportCaseActor extends Actor {
  @Persisted
  state: CaseActorState = emptyCaseState();

  async read(): Promise<{ version: number; snapshotJson: string | null }> {
    return {
      version: this.state.version,
      snapshotJson: this.state.snapshotJson,
    };
  }

  async commit(input: CaseCommit): Promise<CaseCommitResult> {
    const update = await commitCaseState(this.state, input);
    this.state = update.state;
    return update.result;
  }
}
