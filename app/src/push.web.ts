// A browser tab is not told about agents when it is closed, so there is nothing to register
// and no notification to have been opened from.
export const pushToken = async (): Promise<string | undefined> => undefined;
export const useTapped = (): { agentId: string; device?: string } | undefined => undefined;
