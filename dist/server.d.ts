export type BugReporter = {
    name: string;
    email: string;
};
export type BugReportRouteOptions = {
    intakeUrl: string;
    intakeKey: string;
    reporter: (request: Request) => BugReporter | null | Promise<BugReporter | null>;
    limit?: (request: Request, reporter: BugReporter) => number | null | Promise<number | null>;
};
/**
 * createBugReportRoute returns a Fetch-API handler for POST bug reports. It checks
 * a report the way bugkit's Go handler does and relays it to the intake with the
 * key kept on the server.
 */
export declare function createBugReportRoute(options: BugReportRouteOptions): (request: Request) => Promise<Response>;
