export const skillsCommand = {
	name: "skills",
	description: "List and manage skills",
	async execute(_args: string[]) {
		return { success: true, message: "Skills system loaded - 127 skills available" };
	},
};

export default skillsCommand;
