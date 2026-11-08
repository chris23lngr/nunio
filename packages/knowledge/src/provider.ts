import { isDefiniteFailure, SourceModelRejected } from "@nunio/ai";
import { DefiniteFailure } from "@nunio/delegation";

/** Runs a provider call inside `meter`, marking a rejection that certainly incurred no usage so its reservation is released. */
export async function definitely<T>(call: () => Promise<T>): Promise<T> {
  try { return await call(); }
  catch (error) {
    if (error instanceof SourceModelRejected || isDefiniteFailure(error)) throw new DefiniteFailure("Provider rejected the request", { cause: error });
    throw error;
  }
}
