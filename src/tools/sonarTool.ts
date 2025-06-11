import { Tool } from "langchain/tools";
const sonarScanner = require("sonar-scanner");

export class SonarQubeTool extends Tool {
  name = "sonarqube_analyzer";
  description = "Performs comprehensive code analysis using SonarQube";

  async _call(input: string): Promise<string> {
    const analysis = await this.performSonarScan(input);
    return JSON.stringify(analysis);
  }

  private async performSonarScan(projectPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      sonarScanner(
        {
          serverUrl: process.env.SONARQUBE_URL || "http://localhost:9000",
          token: process.env.SONARQUBE_TOKEN || 'sqp_3266ae970e2eb1ef652b6c034f0e7d944faf19a3',
          options: {
            "sonar.projectKey": "technical-debt-detective",
            "sonar.sources": projectPath,
            "sonar.language": "js",
            "sonar.sourceEncoding": "UTF-8",
          },
        },
        (error: any) => {
          if (error) {
            reject(error);
          } else {
            resolve({ status: "completed" });
          }
        }
      );
    });
  }
}
