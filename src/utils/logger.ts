import * as vscode from 'vscode';

export class Logger {
    private static outputChannel: vscode.OutputChannel;
    
    static initialize() {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel(
                'Technical Debt Detective'
            );
        }
    }
    
    static info(message: string, ...args: any[]) {
        this.log('INFO', message, ...args);
    }
    
    static warn(message: string, ...args: any[]) {
        this.log('WARN', message, ...args);
    }
    
    static error(message: string, error?: any) {
        this.log('ERROR', message);
        if (error) {
            this.log('ERROR', error.stack || error.message || error);
        }
    }
    
    private static log(level: string, message: string, ...args: any[]) {
        if (!this.outputChannel) {
            this.initialize();
        }
        
        const timestamp = new Date().toISOString();
        const formatted = `[${timestamp}] [${level}] ${message}`;
        
        this.outputChannel.appendLine(formatted);
        
        if (args.length > 0) {
            this.outputChannel.appendLine(JSON.stringify(args, null, 2));
        }
    }
    
    static show() {
        this.outputChannel.show();
    }
}