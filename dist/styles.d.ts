export declare const styles: {
    overlay: {
        position: "fixed";
        inset: number;
        zIndex: number;
        display: "flex";
        alignItems: "flex-start";
        justifyContent: "center";
        padding: number;
        overflow: "auto";
        background: string;
    };
    panel: {
        display: "flex";
        flexDirection: "column";
        gap: number;
        width: string;
        maxWidth: number;
        padding: number;
        borderRadius: string;
        background: string;
        color: "var(--color-card-foreground, #171717)";
        fontSize: string;
    };
    title: {
        margin: number;
        fontSize: string;
        fontWeight: number;
    };
    columns: {
        display: "flex";
        flexWrap: "wrap";
        gap: number;
        alignItems: "flex-start";
    };
    imageColumn: {
        flex: string;
        minWidth: number;
    };
    formColumn: {
        flex: string;
        minWidth: number;
        display: "flex";
        flexDirection: "column";
        gap: number;
    };
    label: {
        display: "block";
        marginBottom: number;
        fontSize: string;
        fontWeight: number;
    };
    textarea: {
        width: string;
        minHeight: number;
        padding: number;
        border: string;
        borderRadius: string;
        background: string;
        color: "var(--color-foreground, #171717)";
        font: "inherit";
        resize: "vertical";
    };
    radioRow: {
        display: "flex";
        alignItems: "center";
        gap: number;
        fontSize: string;
    };
    placeholder: {
        display: "flex";
        flexDirection: "column";
        alignItems: "center";
        justifyContent: "center";
        gap: number;
        minHeight: number;
        padding: number;
        border: string;
        borderRadius: string;
        color: "var(--color-muted-foreground, #666666)";
        textAlign: "center";
    };
    image: {
        display: "block";
        maxWidth: string;
        border: string;
        borderRadius: string;
    };
    contextTable: {
        width: string;
        borderCollapse: "collapse";
        fontSize: string;
    };
    contextKey: {
        padding: string;
        textAlign: "left";
        fontWeight: number;
        color: "var(--color-muted-foreground, #666666)";
        whiteSpace: "nowrap";
        verticalAlign: string;
    };
    contextValue: {
        padding: string;
        wordBreak: "break-all";
    };
    actions: {
        display: "flex";
        justifyContent: "flex-end";
        gap: number;
    };
    primaryButton: {
        height: number;
        padding: string;
        border: string;
        borderRadius: string;
        background: string;
        color: "var(--color-primary-foreground, #ffffff)";
        font: "inherit";
        cursor: "pointer";
    };
    secondaryButton: {
        height: number;
        padding: string;
        border: string;
        borderRadius: string;
        background: string;
        color: "var(--color-foreground, #171717)";
        font: "inherit";
        cursor: "pointer";
    };
    /**
     * Send and Cancel say aria-disabled rather than disabled, so the browser does
     * not grey them for us. Without this the two look live while they are inert.
     */
    buttonBusy: {
        opacity: number;
        cursor: "not-allowed";
    };
    toolbar: {
        display: "flex";
        flexWrap: "wrap";
        gap: number;
        marginBottom: number;
    };
    tool: {
        height: number;
        padding: string;
        border: string;
        borderRadius: string;
        background: string;
        color: "var(--color-foreground, #171717)";
        font: "inherit";
        fontSize: string;
        cursor: "pointer";
    };
    /**
     * The full `border` shorthand, not borderColor. `tool` sets the shorthand, so
     * a longhand here means the active button gains and loses borderColor as the
     * selection moves — and React logs "mixing shorthand and non-shorthand
     * properties can lead to styling bugs" on every tool switch.
     */
    toolActive: {
        background: string;
        border: string;
    };
    /**
     * The one colour the folder does not borrow from the panel. `--color-destructive`
     * is 3.79:1 on the dark card, under the 4.5:1 a body-text error has to clear,
     * and no single literal can pass against BOTH a white card and a #1a1a1a one —
     * the two requirements point opposite ways. light-dark() reads the color-scheme
     * the theme already sets (`:root` light, `.dark` dark), giving 6.5:1 and 7.3:1.
     */
    error: {
        color: "light-dark(#b3261e, #f28b82)";
        fontSize: string;
    };
    muted: {
        color: "var(--color-muted-foreground, #666666)";
        fontSize: string;
    };
    counter: {
        alignSelf: "flex-end";
        fontSize: string;
        color: "var(--color-muted-foreground, #666666)";
    };
    phaseRegion: {
        display: "flex";
        flexDirection: "column";
        gap: number;
    };
};
