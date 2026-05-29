#Raw_prompts-CLI


### **UI and appearances**

Initially the UI of the application should be when the application is installed by running the command : `npm install -g pakalon` or        `bun install -g pakalon` the application can run by simply typing the command as 'pakalon' in the terminal, the application starts with the logo and the banner with the ascii format( which I have)

At the first time when the user wants to login to my application he will be given with the link for authentication and 6 digit code in terminal, which the backend will process and when the user authenticates by clicking link and sigin up/login then the user may needed to paste that 6 digit code. If the code which has been displayed in the terminal is correct and matches the backend the user may authenticate, and can start using the application. 

The main interface should be logo and below that the chat bar for interaction between the AI agent, in the main interface it should show the default model that the user is been using or the default model that is selected. 

And below the chat interface there should be context window in that window it should show how many context is used and how many is left over to be used. 


**Working**

The application is generally divided into 2 parts:
1. pakalon initailsied : .pakalon-agents
2. Normal mode : .pakalon

### **1. When pakalon is initailised :**

# How to initailse pakalon method of building the application ?

when "/pakalon" command is run then the .pakalon folder is created and the file structures also created inside that,
when the user types as"/pakalon" only .pakalon folder is created and all the file structure is created and then the phases from 1 to phase 6  agentic AI should start. If the project is already built to some extend then when the user initialses /pakalon and then this command should understand what the project is about and about till what the user has created, for example if the user wants to create some e commerce website and already build 50% of the application using his own tech stack then the AI agent should be able to analyse this project codebase and then automatically fill the markdown files like Subagents 3.md, subagents4.md like that. And if the project is not fully completed then upto which portion the project has comepleted till that the filling should happen. And also if the user has mentioned that no frontend design is needed then the frontend should remain the same. This is the complete working of pakalon methodolgy
The application can work even when .pakalon-agents folder is not initalisied also and even when initalised also, so the working is divdied into 2 paths like when /pakalon is initialized and when /pakalon is not initailized

# There are 2 types of modes are the there to build the application :

1. Human in loop mode
2. YOLO mode


I wanted to build the AI agents as phases and then pass information from one phase to another, these agents are given with specific set of instructions and commands despite the AI models that are being used whatever the AI model can be but the AI model must be integrated in the code editor to make these phases happen, better AI model and AI model provider better the results, the working of the phases is I have given to you in that according to each phase (AI agents) they to their work accordingly as per the user instructions or prompt. 

Each Phase(AI agents) are build and they have are given with specfic instructations and commands are given to them, like for frontend subagent it should be able to work only on that task that is given to them, not beyond their work that is allocated to them.

**Phase 1: Planning & Requirements**

In this phase the AI agents should  get the input from the user about what is he building and what are the features and requirements that the application must have and also there should be like a conversation with the user to get the complete details - the AI agents should  ask more question and get a clarity about the project and then if the user satisfied and then happy with the planning process and if the user is not satisfied then the process continues in loop , the more question will be asked like about tech - the frontend , backend methodologies that is be to used and then get a clear idea and if the user satisfied and approves the planning the next phase starts.
There should be a brainstorming session and question and answering session between the user and the AI agents and also the AI agents should ask many more and more questions regarding the tech stack and the methods that are about to be implemented, 
The interaction between the user and the AI agents should take place in the preview section of the workspace after the user gives the 1st input like building some software application, if the user is in the human in loop mode : 
The interaction between the user and the AI agents should take place like after the 1st input the AI agent in the phase should be able to get idea what the user is trying to build and the brain storming session and the Q/A session should take place in the form of multiple choices like the AI agent will give the tech stack that are to be used like the possible tech stack that are to be used in the application that the user is building in a options, there will be some options that the AI agent will plan and give it to the user and if the user chooses any one then the AI and the AI agent takes that as the input from the user and then plans more and also there should be a another choices also like : get the input tech stack requirement from the user and also there should be an option to skip the phase 1. In detail for the frontend there will be an interaction between the user and the AI agent how the frontend should be, similarly  for all the things that the planning AI agent needs that interaction and the information should be got from the user and the AI agent should prepare some relative question and should be displayed below these choices whenever there is an interaction that is happening, and when the user clicks on to that question and the AI agents should make the question and the choices for that question as an interaction between the user and the AI agent. And for information gathering use web scrapping use Fire crawl and MCP servers(firecrawl, puppter, context7), vercel's agent browser and get the information and then plan accordingly. And this AI agent should contain some specific prompts as a system prompts for asking and interacting with the users.  For example if the user gives the prompt as : create a full stack application on building a SaaS application on food delivery app, This AI agent should be able to fetch the details from the internet for existing already available and then load the information that this AI agent has got from web scraping and with the help of MCP server and then saves this information in the memory of the AI agent and then uses this information to ask the question to the user in multiple choice and only any 1 is choose able not a multiple options cannot be choose like the AI agent should ask the frontend to be used in options : 
1. Option 1 - HTML, CSS, JS
2. Option 2 - Reactjsx, next,js, vite, Shadcn UI
3. Option 3 - electron, vite
4. Option 4 - The input from the user, the user;s choice
5. Option 5 - End phase 1 and start phase 2
And some follow up questions below these regarding this question like : 
Do you want to implement a 3d design in the frontend
Do you want a dual theme option or mono theme option

And when the user clicks on the follow up question then the multiple choice opens ans keeping as the question and then the answer for that question when the user selects that choice then that is taken as input and then that is saved in the memory of the AI agent of the phase 1, 


If the user chooses the YOLO mode then the AI agents  itself plans everything and then works accordingly the user’s role of asking and interacting restricted in this kind of mode all the work and everything is planned and documented only by the AI itself only there is no human interaction between the AI agents 

Actually there are some additional features like, In phase 1 there are some additional features like If the user gives the complete tech stack about what should be build to the application, then for clarification again the phase 1 AI agent will ask some general questions, 
For eg : If the user gives the prompt as "Build me a complete website for e commerece, frontend - html, css, js and backend - postgreq." If the prompt is like this then only some extra questions should be asked like, which tech stack can be used for authentication and payment like that some follow up questions can be asked 
And if the user gives a plain prompt for eg: "Build a ecommerece website" Then the ques like For what purpose the application is build? what can be the tech stack? Who are the application's target auidence? and etc like these the follow up questions should be asked and minimum of 10 questions to be asked and the user's response to those questions (answers) are saved in memory (may be mem0) 
And when asking each question the last option for the user to choose is end phase 1, when this is clicked the phase 1 stops and all the .md files are generated and the contents are filled and then the next phase 2 starts to executes, if the user chooses some other option instead of this end phase 1 then the follow up questions should continue. 

When this folder is initialized then inside this folder only the plan.md file, task.md file, user-stories.md, context management.md file will be present. And these file are automatiaclly created and the contents inside these files are automatically filed by the prompts that the user gives, for example the user may ask pakalon to create a website for the landing page for food-delivery after initialzing the      /pakalon, then based upon this prompt that the user has given then pakalon will make a detailed plan and then fill plan.md with the plan that the AI agent has made, and also create the task.md and user-stories.md file, and after these files are created then the based upon the contents of these files the context-management.md file is created. In this file the context to be used for the application should be present, the agent will allocate the tokens and the context based upon the tasks that are the created, like for each tasks the tokens will be allocated and extra 10% will be there as a buffer and the AI agent will try to complete the tasks within the token context. For each tasks there will be some allocated tokens by the AI agent with total of 10% extra as buffer.

If the user gives the complete tech stack about what should be build to the application, then for clarification again the phase 1 AI agent will ask some general questions, 
For eg : If the user gives the prompt as "Build me a complete website for e commerece, frontend - html, css, js and backend - postgreq." If the prompt is like this then only some extra questions should be asked like, which tech stack can be used for authentication and payment like that some follow up questions can be asked 
And if the user gives a plain prompt for eg: "Build a ecommerece website" Then the ques like For what purpose the application is build? what can be the tech stack? Who are the application's target auidence? and etc like these the follow up questions should be asked and minimum of 10 questions to be asked and the user's response to those questions (answers) are saved in memory (mem0) 
And when asking each question the last option for the user to choose is end phase 1, when this is clicked the phase 1 stops and all the .md files are generated and the contents are filled and then the next phase 2 starts to executes, if the user chooses some other option instead of this end phase 1 then the follow up questions should continue

The phase 1 AI agent should be able to create 2 more markdown files, they are plan.md and tasks.md. Based upon the prompt that the user gave and the interaction that is made between the user and the AI agent, based upon those chats the plan to build the entire application is created on the requirement of the user and after the plan.md is created and in this file the entire plan, requirement, specification, everything should be mentioned and then from the plan.md file and the memory of the AI agent then the tasks.md file is created, in this file based upon the user requirement and the follow up ans the tasks are created like to build the entire application, each phase is split up into tasks and then the application is build accordingly. 
this plan.md and taks.md should happen before the phase1.md, this phase1.md is mixture of all the files that are present in phase 1 sub directory, everthing that are present in each file will be present in this file but in a short manner, the detailed description will be present inside each files only.

And also in phase 1 the AI agent should create another markdown file called as design.md file which creates the complete skills on telling how the design of the application should look like, by having this file only the phase 2 should start building wireframes and then phase 3 should start building the actual frontend design
This follows up agent skills by vercel : 
1. https://github.com/vercel-labs/agent-skills 
2. https://skills.sh/vercel-labs/agent-skills 
3. https://github.com/nextlevelbuilder/ui-ux-pro-max-skill 
These are some skills that are present, when the user gives some ideas and design from these skills repo the phase 1 AI agent should find out what skills would match the user's requirement and then use it in the design.md file. 
These repos should be used and the skills from these should be used in the design.md accorindy to the user requirement

The AI agent should create 2 more files called as : API_reference.md file and Database_schema.md files. In the API_reference.md file based upon the plan that is created, it should write a complete API calling and all the functions how the API calling should working everything in this file. And in the Database_schema.md file it should be able to write the complete database schemas for the database that the user or AI agent chooses, it should be able to write a complete backend database for the application that the user is building. These 2 files are directly called and used in phase-3 subagent-2, the subagent-2 should read these 2 files and then start creating the backend using these 2 files.

And another feature that I want to add is that the phase 1 AI agent should be able to create 2 more markdown files, they are plan.md and tasks.md. Based upon the prompt that the user gave and the interaction that is made between the user and the AI agent, based upon those chats the plan to build the entire application is created on the requirement of the user and after the plan.md is created and in this file the entire plan, requirement, specification, everything should be mentioned and then from the plan.md file and the memory of the AI agent then the tasks.md file is created, in this file based upon the user requirement and the follow up ans the tasks are created like to build the entire application, each phase is split up into tasks and then the application is build accordingly. 
this plan.md and taks.md should happen before the phase1.md, this phase1.md is mixture of all the files that are present in phase 1 sub directory, everthing that are present in each file will be present in this file but in a short manner, the detailed description will be present inside each files only.

3. In this phase 1 along with the requirement gathering information from the user then  the AI agent of the phase 1 should be able to generate the agent skills (https://agentskills.io/home )  .md file, prd file, risk assesment file, user stories file, technical spec file, competetive analysis file, constraints and trade : lms platform file .

After the AI agent made the document and saved in the AI agents folder then when the next phase AI agent when the next phase , when phase 2 starts then it should be able to start by reading and analysing the phase-1.md and then only the next phase should start.


**Application: Penpot**

I am using the penpot application for UI designing and wireframe designing. The detailed steps are:

In the phase 2 , 


For YOLO mode :
The AI itself will be able to design the entire wireframe and the user cannot change anything in the design that the phase 2 AI agent have generated

The designs like then phase 2 and in the phase 3 subagent 1 - wireframes and the actual UI/UX designs that the user has requested for.
This is how the application should work. 

The generated design should be as like separate elements like when the header is clicked inside the penpot section then the header is selected and the changes can be made to them accordingly.  The same thing for the other sections also and all the sections and elements of the application also. 
 
When using penpot application to alter, edit or modify some changes and then save the design(with changes) that time the syncing will happen via a sync file - sync.js, The working of this sync file is that whenever the user opens up penpot application in browser the user will see the penpot application's interface so when the user needs some changes in the application, he/she will be able to make changes in the frontend that pakalon AI agent have generated. 
The working in the backend should be like the sync.js should be running in the background and when the user makes some changes in the frontend (via local browser) then using the sync.js file it should be running when penpot application is opened, when the user makes some changes in the application, this file should act as bridge between the changes that are made in penpot via frontend and backend file syncing. In the code there should be cooldown period which prevents the excessive token usage. Whenever the file changes are made if the ysnc.js file should be running so that the changes made are automatically triggered and those updated wirframe/design are saved in the backend, after the changes are made and completed, this sync.js file stops. The sync.js automatically starts when the penpot is opened, and closes when penpot is closed, the starting and stoping of penpot is entirely depends on sync.js file only. 

The penpot automatically opens up when the wireframe or design is generated, it opens up in the browser automatically or if the user wants to open up the and see the generated disgn or wireframe then the user may run "/penpot" when this command is run then the design that is generated in that project session should open up in the browser. The user may have differenet projects and when running "/pakalon"  in separte project then the AI agent should open up and show what the design that is been generated for that project. 


### **phase 2 : Wireframe generating** 

When this phase is starting it should automatically call and place the phase 2 AI agent and then it should read the phase-1.md file and then should come to a clear idea before starting this phase of AI agents, this process should start automatically when this phase 2 phase is started.


UI/UX Design Team - Creates wireframes
Software Architecture Team - Designs the high-level system architecture, outlines component structures, modules and their interactions.
In this phase 2 , you will generate some wireframes first from the detailed that you have gained from planning  and then if the user approves that then the next phases starts 
The wireframe design should be designed shown and opened in the local host browser, like after generating the wireframe it opens up the browser and shows the generated wireframe and in this browser only the penpot application also should start and if the user makes any changes in the designs using penpot element changes then that are reflected in the actual design that the AI agent have generated and that are stored in the phase 2 folder.


If the user has no changes to make in the design and the user if completely happy with the wireframe that the phase 2 AI agent generated and then there will be a “Accept this design”
button if that button is clicked then the AI agent phase 2 is stopped and then this phase starts to generate the documentation about the changes that are made and the designs that are generated along with the changes that the user has requested and made the changes. 

Then after the documentation is created from the memory of that phase 2 AI agent then that documentation about the design that is made and the pages that is created then that documentation is created either as phase2.md file 

And also the wireframe design that is generated are saved in the new folder as wireframe, and when the development phase that is when the phase 3 starts then the design should be made in from this wireframe only, in detail the frontend that is to be generated should be made keeping this wireframe as reference only, like the placement of elements and the size of the page and the number of the pages that are present in the wireframe design should be exactly the same should be present in the UI and the frontend that is to be generated also.

In this phase add a test driven development - TDD with the screen shot for the generated wireframe and deisgn, it should take the screen shot of what is genarted and compare it with the user requirement about buttons, elements and componenets placement and if the screen shot which is taken by the AI matches with the requirement that the the user gave then the next part starts to work, and if the screen shot doesnot match with the requirement that the user gave then the phase 2 AI agent regenartes the designs accordingly to satisy the requirement that the user has given. 

the test driven development will happen like with the help of agent browser the AI agent or sub agent will look into the design that is generated and verify if the frontend is build according to the user's needs and then will take a screen shot and save that screen shot into the respective phase like if it is in wireframe generation, then save it into phase 2 directory, only if the user approved( Human in Loop mode, For Yolo mode it is automatically approved), and if not approved then the AI agent will ask for modifications and changes through the chat interface, and then the AI agent will look into the screen shot for which part the user have asked to changes and then comes to the wireframe that is generated and then makes changes to that wireframe according to the user's requested change. 

During the testing part, after the entire application is build during the testing part of the application, pakalon application will start the application in local server, the frontend and backend (if backend exist) and then with the help of the chrome mcp dev tool : https://github.com/ChromeDevTools/chrome-devtools-mcp , the application that the user has created should open in chrome browser and then the  chrome Dev tool MCP will act upon, and test the application like, if the application is about filling out forms or applying to job, then the chrome MCP dev tool and agent browser should test each buttons test the working of the application and then after testing the entire application, and then give the phase 3 agent a complete report about the working of the application if there are any errors are there like that everything it should be reported along with the screenshot and screen recording of the application, then the AI agent will look that screenshot and screen recording and read the report that is generated and find out the issue or errors and if any of them are present then this subagent will allocate the work to that respective subagent and fix that issue or error. This is the working of testing part with chrome dev mcp tool and agent browser. 

when the command "/update" is typed then the whatever the changes that the user wanted to make in the design that the AI agent has made are changed, for example : If the user wants to change something in the navigation bar then the user may type as "/update the navbar must be rounded in shape" Then having this as the prompt and the user input then the AI agent will start making change only on that particular change that the user has mentioned out. The main purpose of this tool is that when this tool is called then whatever the changes that are mentioned alone should be made, other than what is mentioned nothing should be made. 

The wireframes which are generated are saved as .svg as primary and the secondary is saved as .json and .penpot. So the wireframes that are generated are saved as in formats .json and .svg and .penpot inside the phase 2 folder. 




**Phase 3: Development & Implementation**

In this phase 3 , from the planning -phase 1 and designing- phase 2 you have to get a clear idea of how to implement the features and then you will create the frontend design based upon the wirframe that is generated in phase 2 and also write the code based upon that the user has given in phase 1. 

The Phase-3 will start to code and start to build the application by read and understanding all the markdown files that the phase 1 AI agent have created and based upon that AI agent only the phase will start to code, and based upon the plan.md, tasks.md, design.md it understands the plan on creating the application and it start deisigning the frontend based on the design.md file and start to complete the tasks completely based on the tasks.md file, like the tasks.md and the user_stories.md files segarted the work into smaller tasks the AI reads and understands them and start executing all of them one by one. 

The test driven development will happen like with the help of agent browser the AI agent or sub agent will look into the design that is generated and verify if the frontend is build according to the user's needs and then will take a screen shot and save that screen shot into the respective phase like if it is in wireframe generation, then save it into phase 2 directory, only if the user approved( Human in Loop mode, For Yolo mode it is automatically approved), and if not approved then the AI agent will ask for modifications and changes through the chat interface, and then the AI agent will look into the screen shot for which part the user have asked to changes and then comes to the wireframe that is generated and then makes changes to that wireframe according to the user's requested change. 

For frontend development to use the designs and the assets and the components for css should be Tailwind css and shadcn UI and Radix UI use these for frontend and also using the assets and the components from the online website using the Registry-based Retrieval-Augmented Generation (RAG) and also using web scrapping by using fire crawl and the assets and the components from the website like there will be many website if the user likes some particular design and the frontend of that website then the user can give the link of the website that he/she likes and by seeing and analyzing and getting the complete details of the website that the user gave then the phase 3 AI agent shall proceed to implement that same looking features and design from those websites.

During the testing part, after the entire application is build during the testing part of the application, pakalon application will start the application in local server, the frontend and backend (if backend exist) and then with the help of the chrome mcp dev tool : https://github.com/ChromeDevTools/chrome-devtools-mcp , the application that the user has created should open in chrome browser and then the  chrome Dev tool MCP will act upon, and test the application like, if the application is about filling out forms or applying to job, then the chrome MCP dev tool and agent browser should test each buttons test the working of the application and then after testing the entire application, and then give the phase 3 agent a complete report about the working of the application if there are any errors are there like that everything it should be reported along with the screenshot and screen recording of the application, then the AI agent will look that screenshot and screen recording and read the report that is generated and find out the issue or errors and if any of them are present then this subagent will allocate the work to that respective subagent and fix that issue or error. This is the working of testing part with chrome dev mcp tool and agent browser. 

Exit 0 means success. pakalon should parse stdout for JSON output fields. JSON output is only processed on exit 0. For most events, stdout is only shown in verbose mode (Ctrl+O). The exceptions are UserPromptSubmit and SessionStart, where stdout is added as context that pakalon can see and act on.Exit 2 means a blocking error. Claude Code ignores stdout and any JSON in it. Instead, stderr text is fed back to Claude as an error message. The effect depends on the event: PreToolUse blocks the tool call, UserPromptSubmit rejects the prompt, and so on. See exit code 2 behavior for the full list.Any other exit code is a non-blocking error. stderr is shown in verbose mode (Ctrl+O) and execution continues

And in the phase 3 during the testing process there should another file created that is the log file, in that log file from the 1st prompt , 1st file calling till the last step everything should be saved there like what are the codes that are written and tools and mcp servers that are called everything that should be mentioned here, so in the phase 3 sub agent 5 should look into this file and then validate and look out for any errors or issues in the application

when the command "/update" is typed then the whatever the changes that the user wanted to make in the design that the AI agent has made are changed, for example : If the user wants to change something in the navigation bar then the user may type as "/update the navbar must be rounded in shape" Then having this as the prompt and the user input then the AI agent will start making change only on that particular change that the user has mentioned out. The main purpose of this tool is that when this tool is called then whatever the changes that are mentioned alone should be made, other than what is mentioned nothing should be made. 

The phase 3 AI agents is divided into subagents using  Langgraph, phase 3 is a  time taking process were the entire code are written bugs are fixed the frontend is developed and the backend is connected so a single AI agent cannot do all these task alone it can do it all alone but the time and memory consumption will be higher 
So this phase main AI agent is divided into subagents to reduce the workload on the main agent and they are as follows: 

1. Subagent-1 : Frontend designing
2. Subagent-2 : Backend framing
3. Subagent-3 : Frontend and backend integration
4. Subagent-4 : Bug fixing, debugging and testing the codes written
5. Subagent-5 : Feedback and review session


These subagents are automatically called and executed on its own one by one in step wise the same I have given above. 
 
Web scrapping for frontend designing:

For frontend development that is in phase using the AI sub agents to generate modern UI and design I have some websites :


https://lightswind.com/components 

https://reactbits.dev/ 

https://daisyui.com/ 

https://preline.co/index.html/ 

https://tailwindflex.com/ 

https://dribbble.com/ 

https://magicui.design/ 

https://spline.design/ 

https://www.aura.build/browse/components 

https://www.aura.build/components 

https://shadcnstudio.com/

https://tweakcn.com/


These are some URL’s of some available that using web scraping the elements, assets, components can be used in the application that the user is building. In detail if the user has asked to create some website or the UI, if the user gives the prompt and then taking that prompt as context the web scrapping should happened and those context should be searched across the websites for assets, elements, and templates then if the user need is matched with the websites available in online then that assets, components, or the UI which the user has been asked for should be used in the application that the user is building. 

And also apart from the these mentioned websites the web scrapping must take place across all the list of available websites on internet according to the context of the user that is giving, this is how the web scraping should work

And the AI agent for designing the frontend : 
for the Human in loop how it should happen is like after the phase 2 is completed and after the wireframes are generated the web scraped content and the element and the components should be placed according to the wireframes that are generated, the frontend design should be matched and the elements and the components should be placed only according to the wireframe that is generated and approved by the user, then the AI agent should work and design according to only the generated wireframe.

And for the YOLO mode: the AI agent will automatically design the wireframe in the phase 2 and according to the wireframe that is designed in the phase 2 then the AI agent will work according to the wireframe that is generated and design the frontend according to the frontend that is generated and do the web scarping according to the prompt that the user gave at the starting, this web scarping is optional but if the user has given some links or the URL in the prompt at the chat section then the AI agent should be able to use the RAG method and then the web scarping should happen and find the element, components, or templates that the user has given as reference and then using that the AI will be able to design that component or the website. 

This is the working web scarpping.

These are some websites from these websites and also apart from these websites there will be some assets and components providing websites will be there from these and those websites using Registry-based Retrieval-Augmented Generation (RAG), Fircrawl and vercel's agent browser And also using the chromaDb and Lnace DB using these 2 the import or the file attached the AI agents must get the information from those and imbed it to the AI agents and then start working on the application. 
Registry-based Retrieval-Augmented Generation (RAG) :  The application maintains a curated registry.json index that acts as a map, linking semantic descriptions (e.g., "interactive 3D globe") to the raw source code or API endpoints of high-quality external components (such as React Three Fiber snippets or Spline embed codes). When a user requests a specific 3D design, your system searches this registry for the best match, programmatically fetches the component's code definition, and injects it as "context" into your Large Language Model (LLM). The LLM then generates the final frontend page code by treating this fetched 3D component as a verified building block, automatically handling the complex imports and configurations required to seamlessly integrate the external asset into the user's project


After making the frontend the subagents should document their work done in the folder AI agents and then create a new subfolder called as phase 3 folder save the file as subagent-1.md file in the subfolder of phase 3

## 1. Sub agent - 1 : Frontend designing 

This subagent should start designing the UI and frontend based upon the wireframe that is generated and use the tech stack that is given in phase 1.

This sub agent should be able to start the designing and then this is the agent which should be able to web crawl through the websites and finalising the designs and getting an idea from the already available websites and make use of the components and the packages(Tailwind CSS and Shadcn UI) and then install them in the terminal  for example : if the user asking for the next js application the command for the next.js like npx command should be installed first and then design the frontend according to the wireframe that is created by the phase 2 and then this subagent should be able to design the frontend according to the user requirement. The frontend design should be exactly what the user have asked and confirmed the wireframe in the phase 2, that wireframes which is created in the phase 2 is saved in the folder called as the wireframes, this AI sub agent should be able to refer that and use that and then design the application accordingly. After completing the work for the Human in loop mode there should be the confirmation of the button in the IDE section like "confirm edit” and “make changes” when the confirm edit button is clicked then the design and the frontend codes are saved and if the “Make changes”  button is clicked then it takes to chat section and then asks for the user to give the input that the changes to be made in the design or in code, and then this subagent starts again according to the user’s input message. And for the YOLO mode all the actions are taken by the AI sub agents itself like if the AI sub agents finds that design is satisfying the need of the user then that Sub agent will automatically accept that design. After the sub agent 1 is completed then the codes for the frontend are saved in the sub folder called as frontend and what are the work done by this sub AI agent 1 are saved as Subagent-1. md in the subfolder phase 3 under the parent folder called as AI agents.

In this phase add a test driven development - TDD with the screen shot for the generated wireframe and deisgn, it should take the screen shot of what is genarted and compare it with the user requirement about buttons, elements and componenets placement and if the screen shot which is taken by the AI matches with the requirement that the the user gave then the next part starts to work, and if the screen shot doesnot match with the requirement that the user gave then the phase 2 AI agent regenartes the designs accordingly to satisy the requirement that the user has given. 


## 2. Sub agent - 2 : Backend Framing

After the Sub agent 1 is completed their working, the sub agents 2 starts their work by 1st reading and analysing the subagent-1.md file and then getting an idea on what the work has been done by the sub agent 1 and then this sub agent 2 starts building the backend.
This starts to write the logic, API routing, API calling, framework everything in the parent folder called as the backend. This subagent will be able to write the backend code in the programming language that the user has asked for if the user is in Human in loop and if the user is in YOLO mode then the subagent will analyse and for the requirement it decides the programming language to be used, framework, tools on its own, and then writes the codes, and then executes the commands in the terminal. And after the sub agent writes the codes in the backend folder, when the work is completed  by the subagent 2 then this creates the work done in the name subagent-2.md in the subfolder called as phase 3 under the main folder AI agents.

## 3. Sub agent - 3 : Frontend & Backend integration

After the sub agent 2 is completed the work done, then the sub agent 3 will start to work, firstly it will start by looking into the work done by the sub agent 1 and sub agent 2 and then look into the files, folders that the sub agent 1 and 2 has created and then get the context and get on their work done and then this AI agent will look each and every files in the frontend and the backend. The work of this AI agent is to integrate the frontend with the backend and then make it as a complete full stack application. This Sub agent 4 should be able to integrate the frontend working with the backend working, for example the frontend will just implement the mock authentication and the backend would have implemented the backend separately this is were the sub agent 4 comes into part and then implements the real working of the authentication by the working of the frontend and the backend and providing the user with the real time full stack working application. Only real time production/enterprise ready application. After the working is done by this subagent then it saves the work that is done by this sub agent as subagent-4.md file in the sub folder phase 3 under the main folder AI agent. 

## 4. Sub agent - 4 : Debugging & testing

After the sub agent 3 have completed the working then the sub agent 4 will start their work by reading the work that is done by the sub agents - 1,2 and 3 in the file subagent-1.md, subagent-2.md, subagent-3.md, respectively then this sub AI agent 4 will start their work . The main work of this sub agent is to read , analyse , get the idea and working of the application, this sub agent 4 will look up to the above work done sub agents 1, 2, 3 and the work done by them and this sub agent should be able to read the codes - line by line and all the files and the folders and then look for any errors or bugs, If this sub agent finds any error in the codes and the working of the codes then this sub agent will auto fix all those errors (auto - fixing errors) and then it looks again after fixing the errors for more bugs or errors if finds any then auto fixes it - like in a loop the sub agent will look up in the codes  until the errors are fixed. And should be able to execute the commands in the terminals to fix the error, according to the error that is found out.  And If the sub agent 4 completes scanning all the files and the folder then if it finds that there is no error then this sub agent 4 will test the full stack application. The testing will be by everything like testing the API calling, working methodology, API routing, and also will test the frontend working by using playwright MCP server and check for any misconfigurations and also executes commands in terminals and looks for the logs in the terminal if finds any errors or bugs or misconfiguration then this subagent will automatically fix those errors and then test again for any errors or misconfigurations, this sub agent runs 2 times loop for finding the errors in the application:
a. Looking for the errors, Bugs in each line of the code and auto fixes it.
b. Looking for errors, bugs , misconfigurations in the entire full stack application working and then auto fixes it.
And then if there is no bugs , misconfigurations are found then the sub agent will finish their work by saving the work done and saving the changes (if any bugs, errors, misconfigurations found) in the name of the file called as subagent-4.md in the folder subagent under the parent folder AI agent.

## 5. Sub agent - 5 : User feedback

This mode is only applicable for Human in loop mode only, and YOLO mode has no functions to do about.

After the work is completed by the sub agent 4 then the subagent 5 starts before starting the work the sub agent 5 should be able to read get context, analyse the information that are made by the sub agents 1,2,3,and 4 and then read the documentations of subagents-1.md, subagents-2.md, subagents-3.md, subagents-4.md, should be able to read the documentations completely. The main working of the sub agent 5 is to make a documentation and send the chats to the user to test and use the application, same like in the phase 1. This sub agent 5 will be able to send the message in the preview page on how to test the application and then there should be a button in the preview section says” End phase 3 and start phase 4” and also the input like any queries about the application like using the application and the working or if there is any changes to be made in the application. All these kinds of interactions with the user after the application is built should happen in phase 5. If the user asks to make some changes, then the respective phase should work upon and then the changes are made according to the user's request. And if the user is satisfied with the application that is build and f there is no changes to be made and then the user can click on the button “End phase 3 and start phase 4”. This means that the phase 4 is completed. And after the work is completed if there is any changes that is  been asked by the user then this phase will make the changes in the .md file according to the request that is made. For example if the user is requesting the changes in the backend then this phase will make the changes in the backend and after the changes are made then by the phase 5 then the phase 5 will overwrite the subagent-5.md file accordingly. This is what I am saying and also this sub agent will write a work done document in the name as subagent-5.md in the subfolder called as phase 3 under the parent folder AI agents.

Back-End Development Team - Builds server-side logic, develops APIs for communication between front-end and back-end, manages databases and ensures data security
Database Team - Creates and maintains database structures, ensures efficient data storage and retrieval systems
The AI subagents should be able to create a database for the user’s need according to the need that the user has then the subagents should be able to create the backend ,  the subagents should be able to connect to the backend and create table, record , buckets, edge functions, authentication/authorization according to the user’s need

After making the connection then only the subagent which are created using the deepagents and langgraph and langchain will be able to connect 

Full-Stack Development Team - Handles end-to-end development tasks independently, bridges gaps between different development layers

The next subagent will start integrating the frontend with the backend and then starts to make the work of the full application 

This phase should think and work accordingly, and this is time taking process the time taken to complete this phase should be indicated and even if time is taken more also then the AI agent should work accordingly.

Each Sub AI agent will complete their work one after the another automatically when the phase 3 main AI agent is called and they will individually make their work done and what the are and the reference as a with each of their name as follows as a document in the .md file format in a separate phase 3 folder and all the 5 subagents will make a document each.

There should be a new agent in the phase 3 called as the 'Auditor' agent the agent is called by '/auditor' when this command is typed then the working starts for the agents. 

There is another file called as 'auditor.md' file the working is that the AI agent should read the codebase completely and come to a conclusion that what is build, and having this knowledge it should compare it with the user requirements(all the .md files in the phase 1) and then make a detailed report in the auditor.md file about what are the features that are missing and partially implemented in the codebase and what are comlpetely implemented, with comparison to the user's requirement. This agent have only the read tool permission- it scans, analyses, audits, reads the files, folders, logic, API calling, backend schema everything and then keeps everything in mem0 knwoledge and then compares it with the user requirement and then reports in the auditor.md file. 

For the Human in loop mode, after the auditor agent creates the auditor.md file, the AI agent should ask the user for implementing the missing and partially, like 'There are some missing features found : a. implement all of those missing and partially implemented features, b. Do nothing c. Implement only the core features' like this it should ask questions and folllow up answers for that question that are relevant to the codebase and the project. And after user chooses any of the choice, it calls the respective agent or sub agent to work upon the task that were mentioned as missing and partially implemented.
For YOLO mode, after completetion of phase-3 the auditor agent should start automatically and then do the scan and make the report and then after making the report automatically should call the respective/desired Agents or sun agents to work on the tasks that where mentioned as missing and partially implemented. 

After the Auditor agent performs their work by completing the work by scanning and report making, and after the tasks are completeled that where mentioned as missing and partially implemented, then this auditor agent should work again and make a new findings about what are features that are missing and partially implemented and then overwrite the auditor.md file with the version-2 findings. This auditor agent should happen in loop until the user requirement is completled fully and all the user's requirement are completely fullfilled. For human in loop the user may set the no.of iterations to complete the auditor agent and for YOLO mode it is maximum of 10 times this happens in loop. If the report mentions as 100% and everything is satisfied then the auditor agent stops the loop, and then next phase starts on. 

**Implementation status: T-CLI-69 — IMPLEMENTED**
- `/auditor` slash command: `pakalon-cli/src/components/screens/ChatScreen.tsx`
- Agent core: `pakalon-cli/python/agents/phase3/auditor.py` (async, LLM-powered, SSE, Mem0, HIL+YOLO loop)
- Graph wiring: `pakalon-cli/python/agents/phase3/graph.py` (run_auditor node, YOLO auto-loop, HIL standalone)
- Bridge endpoint: `pakalon-cli/python/bridge/server.py` → `POST /agent/auditor`
- Output: `{project_dir}/.pakalon-agents/ai-agents/phase-3/auditor.md` (overwritten each iteration)

**Phase 4: Testing & Quality Assurance**

Trigger Conditions:
Automatically begins when Phase 3 completes and the user chooses “Accept and proceed to phase 4.”
The system reads and analyzes all outputs and artifacts created during Phase 3, including code files, folders, configurations, and system design.
The status and progress of Phase 4 are visibly indicated in the “Preview” section/chat bar.
And should be able to detect and analyse the CI and CD and pipeline review like that also should be there

1. Automated Security & QA Orchestration
Preparation
Load all outputs from phase-3, including the complete source code, directory/file structure, dependencies, and configuration files.
Test Execution Pipeline:
a. QA Scripts & Unit Testing
Run all available unit tests, integration tests, and any generated QA automation scripts.
Validate that the application behaves per requirements and passes all basic quality checks.
b. Static Application Security Testing (SAST)
Tools Used:
semgrep (multi-language code security scanning)
SonarQube Community (optional for deeper code review and coverage)
Gitleaks (secret/key detection)
Bandit (Python-specific, if applicable)
FindSecBugs (Java/other, if applicable)
Automated Scans:
All code is scanned for vulnerabilities, insecure coding patterns, hardcoded secrets/tokens, misconfigurations, and any deviation from best security practices.
Results are collected as machine-readable (JSON) reports.
c. Dynamic Application Security Testing (DAST)
Tools Used:
OWASP ZAP (run as a REST API server or Docker container)
Nikto (web server scan)
sqlmap (SQL injection detection and exploitation)
Wapiti, XSStrike, (additional XSS/DAST tools)
nmap (network/port scanner)
Automated Scans:
The running instance of the user-built application is analyzed dynamically.
Tests executed for: SQL Injection, XSS, CSRF, IDOR, access privilege escalation, backdoors, DoS, DDoS, API misconfiguration, open ports, and other web vulnerabilities.
Each tool’s output is parsed for vulnerabilities and grouped into severity/impact categories.
d. Manual/AI Review (Optional)
Optionally, the Phase 4 AI Agent can use LLM-powered logic to perform additional semantic/logic checks for vulnerability patterns, business logic flaws, or attack vectors missed by static/dynamic tools.
Results and remediation suggestions merged into phase-4 output.


2. Decision & Feedback Loop
If vulnerabilities or test failures are found:
A detailed summary is generated, listing all vulnerabilities, weak points, recommended remediations, and explicit references to files, lines, endpoints, or components affected.
phase-4.md is created with:
Complete findings/report (including tool outputs and AI suggestions)
List of required changes and recommended fixes
“Call-back” instructions to automatically trigger re-entry to Phase 3 (code generation & agent sub-loop) to revise/patch as needed
This loop can repeat (Phase 3 → Phase 4) until the user accepts results or the application is clean.
If no major errors or vulnerabilities are found:
phase-4.md documents a clean security report and the application is marked as strong.
The next phase (Phase 5: Deployment & Integration) is triggered automatically, requiring no further changes to code.
User Actions:
User can review all findings and remediation instructions in phase-4.md from the app UI.
User can request re-testing, triggering Phase 4 again (for example, after a manual fix or new code push).
Optionally, user can override and proceed, bypassing non-critical warnings.


3. Example Outputs
phase-4.md (Partial Example)
text
 Phase 4: Testing & Security QA Summary

Unit/Integration Test Results
- All tests passed: Yes
- Coverage: 94%
- Failures: None

 SAST Results (Semgrep, Gitleaks)
- High: No critical hardcoded secrets
- Medium: Detected 2 instances of weak input validation (see src/utils/validator.js:24)
- Low: 1 unused dependency (cleanup suggested)

 DAST Results (OWASP ZAP, Nikto, sqlmap)
- SQL Injection: Blocked (no injection point found)
- XSS: 1 reflected XSS found in /search (see details)
- CSRF: CSRF tokens verified
- Open Ports: All non-essential ports are closed
- DoS/DDOS: No vulnerability to basic DoS scripts detected
- API Security: All endpoints require auth, no IDOR detected

 Recommendations
- Escape HTML output in /search (mitigate XSS)
- Enforce server-side input validation in validator.js
- Remove “leftover.jpeg” from /public (unreferenced, risky)

 Pass/Fail Status: FAILED

Next Action
> Calling Phase 3 agents to auto-remediate XSS and validation issues, based on above report.

The AI agent should write test cases (as per to user requirement for building the application) for the application and when the application pases those test case, the application is marked as completed and also there should be black box testing - user stories on the user's POV the testing should happen and white box testing - examines the internal struructure, architectture, system works, actual code implementation. For white box testing use of .xml file which conatin multiple sections and sub sections of test to navigate thorugh the codespace and test the application and write the white box and black box testing file respectively.
Should create whitebox_testing.xml and blackboxtesting.xml file and test acordingly. 

4. Technical Implementation Notes
Tools (semgrep, zap, nikto) are run as containers or server-side binaries by your backend component orchestrating the AI agent workflow.
Results from all security tools are parsed (preferably as JSON/XML) and summarized by the Phase 4 agent (LLM + logic).
The agent manages orchestration: transition control, automated re-calling, and correct UI status updates.
All findings and changes are versioned & associated with codebase snapshots for traceability.


5. Open-Source Components Used (For This Implementation)
SAST: semgrep, SonarQube, Gitleaks, Bandit, FindSecBugs, Brakeman (language-specific)
DAST: OWASP ZAP (REST API), Nikto, sqlmap, Wapiti, XSStrike, nmap
Auxiliary: Burp Suite CE, metasploit, TheHarvester, as needed for advanced/optional tests
Custom AI checks: Implemented via AI agent itself (optional, for logic/business rule analysis)
All these applications are used and integarted into pakalon as docker image

In the testing part - phase 4 the testing part there should be some inbuild test functionalities with the codespace and the requirement document the AI agent should be able to compare them weather the requirement is completely satisfied or not, and if not completely build then the missing or partially (skelton) features should be listed and then again the phase 3 AI agent should start their work by implementing the missing featuures. 

In the same phase 4 - The AI agent should write  test cases (as per to user requirement for building the application) for the application and when the application pases those test case, the application is marked as completed and also there should be black box testing - user stories on the user's POV the testing should happen and white box testing - examines the internal struructure, architectture, system works, actual code implementation. For white box testing use of .xml file and for black box testing also this .xml file should be created which conatin multiple sections and sub sections of test to navigate thorugh the codespace and test the application and write the white box and black box testing file respectively.

 
6. The open-source application which are used in the application are downloaded and used in the AI agents, and also there are  sub AI agents which are used in this phase 
a.	Sub Agent 1 - for SAST
b.	Sub Agent 2 - for DAST
c.	Sub agent 3 - for reviewing the code written by the AI
d.	Sub agent 4 - testing the CI/CD pipeline
e.	Sub agent 5 - testing the best cyber security practices 

## Sub agent 1 :
These application - Semgrep, SonarQube Community Edition, Gitleaks, Bandit, FindSecBugs, Brakeman,ESLint with security plugins, are cloned in the parent folder and then the this Sub AI agent will be called and then tested the SAST application 

After the application have completed building during testing part, the need of API testing part should come into play like the application should use 'Hoppscotch' application which is open source application, when the application is completely is built by the user to test the application using hoppscotch using vercel's agent browser and chrome MCP dev tool, the application runs and then using these agent broswer or chrome dev tool the AI agent automatically writes the API calling and then tests it, By conducting this kind of test by running and manually sending the paramaters and getting the responses to see for any security threat or any code written issues. The AI agent alters the parameters that are sent and looks for any issues or bugs. Hoppscotch is available as web app form so after the phase 3 completes and when the phase 4 starts this method should come under the sub agent-1. All the API calling like POST, GET, etc.. commands are executing and the responses are saved inside the subagent-1.md file, during this part it tests for any vulnerablities like XSS, CSRF, and anything like that by sending the paramaters and modify and sending the parameters and receving the respone and seeing how the response looks like, if the response that is recived contains any errors or issues that mnay cause any vulnerablities, then the AI agent should give the score if there are changes to be made in the code accordingly, if there are some changes to be made that are also mentioned as subagent-1.md/phase-4 file, if there are no changes and the application looks fine without any vulenrablities or errors also that should be mentioned in that file. Please include this.

## Sub agent 2 :
These applications - OWASP ZAP, Nikto, sqlmap , Wapiti, XSStrike, are cloned in the parent folder and then this Sub AI agent will be called and then used and then used and tested for DAST application.

## Sub agent 3 :
This Sub AI agent will be review all the codes, files, folder and review each and every line by line code and look for any issues and review each line of code and the working of functions and logics for any cyber threats that is present 

## Sub agent 4 :
This Sub AI agent will look for the CI/CD and pipelines and then this Sub AI agent will implement the best method

## Sub agent 5 :
This Sub agent will use and implement the best cyber security method and then will test against the cyber attacks like SQLi, CSRF, XSS, Broken injection, IDOR, privilege escalation, DOS, DDOS like these and should be able to test against all the cyber, information, network security. 

7. After everything is completed the each Sub AI agents will save their work done as documents as Subagent-1.md like these for each sub agent should save their work after completing their work by creating a new folder called as phase 4 and then inside this folder only all these sub AI agents will save their work completed documents as .md file 

And then after this phase 4 is completed then the phase 5 is started immediately after this. 


**Phase 5: Deployment & Integration**

Teams Involved:
DevOps Team - Handles software deployment and operations, ensures continuous integration and continuous delivery (CI/CD) by automating deployment pipelines, manages infrastructure and system integration
Release Management Team - Manages how the system integrates into existing systems, software and processes, coordinates the release process
Change Management Team - Implements change management processes to ensure user training and acceptance, manages the transition to the new system

This phase should be able to form regular CI/CD pipelines and by maintaining the proper security measures.

And should be able to push to the github, create PR and solve issues and manage git issues, all these are possibles only if the user system has installed the git application.  

After this the phase - 5 should generate the .md file named as the phase-5.md file and should contain all the documents that this phase 5 has done.  And in the ReadME.md file it should update what has been build. 

**Phase 6: Maintenance & Operations** (optional)

Teams Involved:
Support & Maintenance Team - Provides ongoing technical support, monitors system performance, handles bug fixes and updates after deployment
Operations Team - Manages day-to-day operations, ensures system uptime, monitors performance metrics and user feedback
Product Evolution Team - Gathers user feedback, plans feature enhancements, manages iterative improvements and updates

In this phase-6 the AI agent has to make a documentation for the application that is made for the viewers to see, the documentation should be able to show the working of the application that the user is making. 

This phase 6 has to make the comeplete documentation with the heading and sub heading propely about what are the features that are the present and some specail features that the application has, this AI agent should create documentation as Doc.md file and it should give me the complete documentation, if saw and read this document someone who is using the application that the user is building should be able to understand the complete features that the user has build in this application. 

This is an optional phase and if the user wishes to skip this phase can skip this phase.

For Human in loop mode : The user will be asked to either proceed with the phase 6 ot complete the process, if the user chooses to stop the application then the pakalon application stops and all the phases are stopped. And if the user wants to complete the phase 6 also then the doc.md file is created and documentation is made and then after the documentation is done and over then the phase 6 should be able to make a document about the work done by this AI agent in the AI agent folder as phase-6.md, and the process stops

For YOLO mode: The AI agent will create the doc.md in the main branch of the codebase and then only it will complete all the phases from 1 to 6 and then it fills out the phase-6.md file and then only it stops, this is the complete working


The application structure :

{project-name}/
├── .pakalon-agents/
│   ├── ai-agents/
│   │   ├── sync.js
│   │   ├── phase-1/
│   │   │   ├── context_management.md
│   │   │   ├── plan.md
│   │   │   ├── tasks.md
│   │   │   ├── design.md
│   │   │   ├── phase-1.md
│   │   │   ├── agent-skills.md
│   │   │   ├── prd.md
│   │   │   ├── Database_schema.md
│   │   │   ├── API_reference.md
│   │   │   ├── risk-assessment.md
│   │   │   ├── user-stories.md
│   │   │   ├── technical-spec.md
│   │   │   ├── competitive-analysis.md
│   │   │   └── constraints-and-tradeoffs.md
│   │   ├── phase-2/
│   │   │   ├── phase-2.md
│   │   │   ├── Wireframe_generated.svg
│   │   │   ├── Wireframe_generated.penpot
│   │   │   └── tdd-screenshots/
│   │   ├── phase-3/
│   │   │   ├── auditor.md
│   │   │   ├── subagent-1.md
│   │   │   ├── subagent-2.md
│   │   │   ├── subagent-3.md
│   │   │   ├── subagent-4.md
│   │   │   ├── subagent-5.md
│   │   │   ├── execution_log.md
│   │   │   └── test-evidence/
│   │   ├── phase-4/
│   │   │   ├── subagent-1.md
│   │   │   ├── subagent-2.md
│   │   │   ├── subagent-3.md
│   │   │   ├── subagent-4.md
│   │   │   ├── subagent-5.md
│   │   │   ├── blackbox_testing.xml
│   │   │   └── whitebox_testing.xml
│   │   ├── phase-5/
│   │   │   └── phase-5.md
│   │   └── phase-6/
│   │       └── phase-6.md
│   ├── mcp-servers/
│   ├── wireframes/
│   └── pakalon.db
└── (visible project files - code, README, etc.)


### **Normal Mode** ##

# **WORKING**

Agent team, where the user can create multiple agents and these agents can do parallel tasking, For example : For a project the user can be able to create more than 1 agents which can simultaneously work and then complete the tasks that are assigned to them. This agent teams how it would work is that by initializing via "/agents" when this command is run the question pops up and asking the user to name the agent and then create how to team members that the user needs. Despite the no.of the team members that is been created there will be a parent agent for each agent. To make this work happen the user may simply type the command as"/<The name that the user gave to the agent>" and then gives the prompt like let 1 user create one task and let the another user create another task if that means then, 2 works are done simultaneously and then report it to the parent agent that agent will verify their work done. This is the complete working of the team agents.

Exit 0 means success. pakalon should parse stdout for JSON output fields. JSON output is only processed on exit 0. For most events, stdout is only shown in verbose mode (Ctrl+O). The exceptions are UserPromptSubmit and SessionStart, where stdout is added as context that pakalon can see and act on.Exit 2 means a blocking error. Claude Code ignores stdout and any JSON in it. Instead, stderr text is fed back to Claude as an error message. The effect depends on the event: PreToolUse blocks the tool call, UserPromptSubmit rejects the prompt, and so on. See exit code 2 behavior for the full list.Any other exit code is a non-blocking error. stderr is shown in verbose mode (Ctrl+O) and execution continues

Also there should be the feature of showing the history of file changes made to the application that the user is building. When the "/history" command is typed it should show the history of changes made to the codebase by the user and this should be stored in the backend and should be displayed in the logs section of the website. And also "/history" is typed then the prompts that is send and the no.of lines the code changes where made should be shown along with the time and date stamp. 

And in normal mode whenever the user types the prompt and he wants something to build big then the option for planning should be present. "/plan" if the user types this command then AI agent should analyse what the user have given the prompt and understand the context and then makes a detailed plan of what should be build, and gives the output to the user as markdown file named as output.md  and if the user has any changes to the plan that is made the user can make the alterations in that file and can start building the application by initailsing to build the application by typing as "/build" command in the same session that is being used to planning. 

In each project directories there should be the sessions, same as like "/history" command, whenever the        "/session" command is initialised then it should show the list of the sessions that is been created by the user with the session_id labeled for each session, the only difference is between the /history and /session is that in history it only displays the details but in /session can actually go back to the session that the user has been working with. Whenever the user gives some input to pakalon CLI and then closes it if the user types /resume or /resume<session_id> then the last session(conversation) is brought up back, or simply /session then it displays the list of sessions that the user has given in that particular directory that the user has been working on. The /session and /history differs for each project directory, for example the user may haves created and used 4 session for project 1, that 4 session and the history that is being used should show up for that project 1 and the respective directory alone. And for project 2 the user may have used only one session, so the history and the session should show for that particular project directory alone. This is how the        "/resume", "/resume<session_id>, "/session" , "/history" should look alike. 

And also there should be another command "/new" whenever the user is on one session and wanted to create another one then the by typing the command in the chat interface as "/new" he started a new session with new session_id and then that new session that the user is created and the old session that the user has been working on with all should be stored in the backend, so whenever the user pakalon again on that project directory then the sessions should be displayed. 

For normal mode initally for the new session the application will be in plan mode by default, and during this mode only the read tools will be availble to use and this should be displayed below the chat interface, and to change from plan mode to edit mode the user can simply press the "tab" button to shift between modes, the list of modes are : 1. Plan, 2. Edit, 3. Auto-accept, 4. Bypass mode
1. During the plan mode, only the planing part comes to use, only the read tool is used and no code changes should be made and the plan and the task is created for the user's input
2. And for the edit mode, the file changes made, tool calling everthing are asked for the permission from user and then the based each permission either "accept" or "decline" based on that those permissions the AI agent works upon. 
3. And in Auto-accept mode, all the tool calling and file writting are automatically taken care by the AI agent itself. 
4. This bypass permission is like the YOLO mode when pakalon mode of building the application is initalised, all the planning, file creation and the deletion are taken care by the AI itself only work for the user is to give the input and let the AI agent do its work. 

And also there should be another option for thinking, usually there are some models which has the thinking capacity and some do not have the thinking capacity and initailise the thinking capacity of the models the user needs to press "shift + tab" buttons to initallise the thinking capablity of that particular model that the user is using with. 

And to call and choose between models. the user needs to type as "/models" when this command is typed the list of models from open router shows up and the user may choose between the models. For free users only the free model and for pro users all the models should be present can choose between any models. 
And also by default the model used must be "auto"  this means that the model which have the high context window and the uses less tokens for usage is automatically choosed by the AI agent itself between the models. And if the user wantes to use specific model then the user needs to types the model name or the choose from the list of the models that are listed. 

And in the history session of the application it should the context window used in that particular session and how much the tokens are being used and how much the context window is left out to be used, all these details should be shown in that session when the "/history" is  typed up.

When the command "/agents" are typed in then the option for creating a specific agent are asked upon in pakalon initailised and in normal mode, the user gives a specific prompt for the agent to perform that determnied task alone. For example the user may create the agent to perform reasearch on some topics that he gives as prompt, for this the user has to create the AI agent with some specific command that he wants to add to that, in simple the user instructions, are given as system prompt and instructions for the AI agents, and that AI agent teams are saved in the mem0 and also in the local memory of the application. Along with the prompt for the AI agent team there will be description for that system prompt that the user gave and also colour to choose for each team agent to uniquely identify between themselves.  Each AI agent team is given with a specific name and whenever the user wants to call that agent then the user type as 
"@<agent-name>"  and along with the prompt that the user wants to give and the AI agent will come up in the suggestion when the name is typed. The AI agent can also be given only specfic tool calling that the user may choose, like all the tools the AI agent can use or spefic tools like only read tool like that, that the usage of the tools are based upon the user needs. 

This agent teams can run parallel tasks at the same time. When the AI agent teams (more than 1) are created then the user may call those agents by their name and then when the user calls the agent teams which they have been created and in the chat box the agent will be given those specific tasks and using those the AI agent teams can run parallely at the same time, For example: the user may create Agent teams 1 and name it as 'x' and the another agent team as 'y', the working of 'x' is analysing the codebase about the features that are build and that are missing and partially build. the working of 'y' is to reasearch about some topics across internet, the user may give the prompt as "use agent @x and agent @y and to their respective tasks", then both the agents will work simultaneously on their specific task and give the report to the user in markdown file format about on doing their tasks. 

when the command "/update" is typed then the whatever the changes that the user wanted to make in the design that the AI agent has made are changed, for example : If the user wants to change something in the navigation bar then the user may type as "/update the navbar must be rounded in shape" Then having this as the prompt and the user input then the AI agent will start making change only on that particular change that the user has mentioned out. The main purpose of this tool is that when this tool is called then whatever the changes that are mentioned alone should be made, other than what is mentioned nothing should be made. 

To call and use the agent skills, "/init" command is used whenever this command is used and called upon then the directory .pakalon is created and inside this directory another directory called as agents is created inside this directory the file named skills.md is created and the skills will be based upon the user needs like the user may want the frontend desiging skills then the contents inside the file will be like that. 

When this folder is initialized then inside this folder only the plan.md file, task.md file, user-stories.md, context management.md file will be present. And these file are automatiaclly created and the contents inside these files are automatically filed by the prompts that the user gives, for example the user may ask pakalon to create a website for the landing page for food-delivery after initialzing the      /init, then based upon this prompt that the user has given then pakalon will make a detailed plan and then fill plan.md with the plan that the AI agent has made, and also create the task.md and user-stories.md file, and after these files are created then the based upon the contents of these files the context-management.md file is created. In this file the context to be used for the application should be present, the agent will allocate the tokens and the context based upon the tasks that are the created, like for each tasks the tokens will be allocated and extra 10% will be there as a buffer and the AI agent will try to complete the tasks within the token context. For each tasks there will be some allocated tokens by the AI agent with total of 10% extra as buffer.

After the planing and the tasks and the are created then the AI agent starts coding. Based upon the plan and the tasks created and the user stories the AI agent should start their work, this is working in the normal mode when pakalon is not initailized. 


The application structure : 

.pakalon/
├── agents/
│   └── skills.md
├── plan.md
├── task.md
├── user-stories.md
└── context-management.md



## Usage, plan and billing : 

1. About the account - only the user can be able to login or create a new account using only github authorisation via the clerk authentication
1. I have decided to go by the post paid method of payment and the user's will pay only for what they used in the application, no need to worry about token usage and context window issues.  For the pro user's the user will pay the amount of 2$ as the deposit amount, and should sign up and link the credit card of the user, so the working is that when the user upgrades to the pro plan he/she will be asked with credit card and deposit the amount of 2$ and based upon the token and the model he/she uses they will pay that amount only with the platform fee of 10% of what they used. In detail with example, if the user sigins up during 1 march 2026 and decided to use sonnet-4.6 by antrophic cluade, the pricing for that model is : $3/M input tokens
$15/M output tokens $10/K web search in open router, for 1 month is he uses only 1m tokens using only sonnet 4.6 then at the end of the month, either on 31 march 2026 or 1 april 2026 he will pay 15$ + 1.5$(platform fees) and also the previous amount which he/she have deposited during the upgradation. And if suppose the user decides to use mixture of models in the same months the pricing is calculated for the models that he/she used, for instances if the user used 15 days sonnet 4.6 and for the rest of the days of the month if he uses gpt 5.3 codex which is priced for : $1.75/M input tokens
$14/M output tokens, so the calculation should be like, for the 1st 15 days the token usage of and the pricing of the sonnet 4.6 and the rest 15 days the pricing according to the token usage of the gpt codex 5.3 along with the 10% of platform fees, if the user used 1m tokens in sonnet 4.6 for the 1st 15 days and the 1 m tokens in the gpt 5.3 codex for the next 15 days, so at the end of the month how the user should be billed is that, 1m token pricing of sonnet 4.6 + 1m tokens pricnig of gpt codex 5.3 which is 15$ + 14$ + 2.9$(platform fee which is the total cost of token usage of all the models that the user used). This is how the working and pricing of the pro users should be please implement this methodolgy into pakalon, but now pay only for what you use and post paid method please implement this methodolgy. 
2. The free users can get and can be able to use pakalon for free entirely for lifetime, but only the free models that the users can use it into the application, not any pro models from openrouter, In openrouter whatever the models that are ending with ':free; those models only the free users can use it free for lifetime. 


2. The token usage are calculated for each model and the pricing that the each model provider have setup, like for each model and the seprate model provider they have a different pricing so based upon the price and the token used the price is calculated with 10% platform fee of the total amount that the user have spent. 

3. Based upon the plan the user should be able to use the AI - using Tanstack AI SDK and using openrouter : 
 For free plan : The user will be able to use only the free models and not every models 
 For pro plan : The user will be able to use all the AI models that are listed 

For payment gateway - The payment gateway is polar, the users needs to pay whatever the tokens that the user have used


5. The paid user will be sent with the email notification on the last 7 days( for the last 7 days each day each mail about the remainder about their bill due)  from their due date, this is some kind of remainder to the user to renew their plan and then continue their access to the Pakalon AI code editor without any issues. And also the free users also will be sent with the email notification for the last 7 days - each day each mail for the expiration of their free trial account.

6. Whenever the user opens the terminal, the backend checks that if the user is logged or not and if logged in then checks for usage if the credits are over and completed then cannot send or interact with the application, if credits are remaining then can be able to interact and chat with the application.

7. The user can install the application via command, and the application will only start if the user is authenticated and then if the user wants to upgrade to pro plan, the interface and the payment gateway will be present in that website will I will create, for authentication, if the user is already logged in then the application will open and start and if the user is not logged in then it will redirect to the website from terminal and ask the user to log in and then show the 6 digit code in the terminal and the should copy and paste that code if the code is correct and matched perfectly then the application should be run. 
Even if the user is logged in website and opening the application in terminal 1st time this copy pasting of 6 digit code methodology should work. 

8. And also about the usage and tracking of the application during the installation, pakalon generates and stores unique machine identifiers such as telemetry.machineId, telemetry.macMachineId, and telemetry.devDeviceId in the local storage.json file (e.g., ~/.config/Cursor/User/globalStorage/storage.json on Linux). These IDs uniquely identify the device/installation and are used alongside account info (email/name) to attribute usage, detect suspicious activity (e.g., trial abuse), and enforce limits. Deleting or resetting these IDs (via commands like Ctrl+Shift+P > "Fake pakalon") creates a "new machine" illusion, confirming their role in tracking
It captures IP addresses for geographic location (security/performance), device/browser/OS details, log/error data, and timestamps of access. Usage metrics include AI-specific events: total prompts/tabs, AI requests, line changes (additions/deletions) by Agent/Tab, accepts/rejects of suggestions, chat interactions, and active user status (e.g., if suggestions received or Composer opened). Data is sent to pakalon servers during online use; offline actions aren't tracked.
Privacy Controls
Privacy Mode (in settings) prevents model providers from retaining data and stops /third parties from using code for training, but some code/usage data may still be stored for features. Cookies/trackers personalize/analyze sessions; admins export detailed CSVs/APIs for teams. No sensitive data collected; aggregated/de-identified stats used for improvements



## Applications and the features that the pro and the free user can access:

For free users: 
 Bandit, FindSecBugs, Brakeman,ESLint with security plugins, sqlmap , Wapiti, XSStrike, Penpot

For the pro users: 
Semgrep, SonarQube Community Edition, Gitleaks, Bandit, FindSecBugs, Brakeman,ESLint with security plugins, OWASP ZAP, Nikto, sqlmap , Wapiti, XSStrike, Penpot, and the Image generation feature, penpot




## Additional Informations : 



I wanted to use openrouter in the application and I will be using the API key of the openrouter, There will be only 1 master key and using that master key the free and the pro users can use the free and pro models respectively according to the type of the user, everytime when the user opens the application there should be a basic checking on the type of the user weather the user is free or pro user and then after confirming the type of the user the user can use the AI models accordingly.

When implementing the openrouter as the AI model provider make sure that all the AI models which have been released and also the AI models which will be released in the future also should be implemented in the new to old order, the newest model which is released newly then that should be appeared first. 
For free users only the free models can be accessed by the free users and for the pro users they can access all the models that they desire to use which are available in the openrouter.
https://openrouter.ai/models 
This website contains the list of the models please implement the models that are available in this website

I wanted to implement the import from figma so that the designs that I have made are imported from figma and then after importing the frontend I wanted to start from the phase 1 and how this should work is that If the user is attaching a figma file and then the phase 2 which is for designing should be able to analyse the design that is attached from figma, if there are any minor changes to be made that alone can be made and then proceed to the next phase

The phases / AI agents features which I have mentioned should take place and should be able to interact with user via the chat box like for example in the phase 1 : it will ask for the tech stack from the user and if the user has given some tech stack that will be kept in the memory of the AI agents using mem0 and then proceed with brain storming session like the AI agents asking more and more doubts and details from the user about the tech and the description and the requirement to build the application if suppose the user does not have that much knowledge in the tech stack the AI agent will give some suggestions and recommendation and if the user accepts that tech stack and requirement then that information are stored in the memory(mem0) of the AI agents and AI sub agents for implementation and then after each phase all those information are stored in mem0 for passing that information from 1 phase to another, Like each phase/AI agents when completing their work should document their memory and work done every information they have that is regarding to the project as .md file

The user also has the ability to skip the human in loop method which I have described above like in the same chat box there should be 2 options
a. Human in loop
b. Yolo

a. Human in loop mode - means that the user will have an interaction with the AI agents and sub agents in each phase, there will be a communication with the user and the application is completely built according to the users requirement.

b. Yolo mode - There will be no interaction with the user all the tech stack and the all the features, working , design, everything will be determined by the AI agents and their corresponding sub agents only

Based upon the plan the user should be able to use the AI - using Tanstack AI SDK : 
 For free plan : The user will be able to use only the free models and not every models 
 For pro plan : The user will be able to use all the AI models that are listed 


And also the features of MCP servers should be enabled, https://github.com/modelcontextprotocol/servers 
All the listed MCP servers can be used in pakalon by installing them 
In the chat interface it the user wants to add any mcp server then if the user types the name of the mcp server and the link of it, the mcp server should be added, and there should be a option to add mcp server for pakalon either in the project directory or global installation, 
If global installation, the mcp servers which are installed will be stored in .pakalon folder in the local disk c/users and if the project directory installation then the mcp servers are installed in .pakalon/<project_folder> directory 

when the /pakalon command is run the file structure is created and then the contents inside them is initially empty and then when each phase starts their work the contents are filled according to the work of each AI agents and sub agents. 
If the file structure is already present inside the .pakalon folder then it would ask permission for overwriting the contents inside the folder, if the user allows to overwrite then the new structure is created and then pakalon application and the AI agents will work according to that contents of the files, and if the user declines overwriting the file structure then the application and the AI agent will start working of what is already present inside it only.  If the user is Yolo mode the init command is automatially run and the .pakalon folder is created and if the user is in Human in Loop Mode(HIL) then it would ask for permission from the user and then run the command and then create the folder. 

And also there should be tool calling feature should be present in the application like running some commands like reading, viewing, bash, grep, editing, deleting files folder and accessing web and other terminal based commands  like that should be executed by the AI agents

And also the use of vercel's agent browser should be present, 
https://github.com/vercel-labs/agent-browser  
This is the complete documenttaion and report for use of this agent browser, this agent browser is used in phases 1,2,3 and 4 
Like if the user gives the link/URL of some website and asks pakalon that "I need the design elements mentioned in this website and the theme and styling also" if the user asks something like this then along with the help of the firecrawl- web scarpper , this agent browser should analyse and find out the styling, colour those are present in that website and then update those styling or whatever the user asked from that website into design.md 
And also after generating the designs, the generated design will be opened in local host (browser) this agent browser will look into and starts performing their work and then will compare this design with the phases 2's wireframe generated and also with the user's requirement and verify allignment and everything, if it finds everything is perfect and correct then it proceeds to the next subagents. 

And the application should have the image analysis capabilities, unlike google's antigravity, cursor and claude code cli, when given any screen shot of image should be able to analyze what is present in that image and then work accordingly. And also should be able to view the video and analyse the video

During the testing part, after the entire application is build during the testing part of the application, pakalon application will start the application in local server, the frontend and backend (if backend exist) and then with the help of the chrome mcp dev tool : https://github.com/ChromeDevTools/chrome-devtools-mcp , the application that the user has created should open in chrome browser and then the  chrome Dev tool MCP will act upon, and test the application like, if the application is about filling out forms or applying to job, then the chrome MCP dev tool and agent browser should test each buttons test the working of the application and then after testing the entire application, and then give the phase 3 agent a complete report about the working of the application if there are any errors are there like that everything it should be reported along with the screenshot and screen recording of the application, then the AI agent will look that screenshot and screen recording and read the report that is generated and find out the issue or errors and if any of them are present then this subagent will allocate the work to that respective subagent and fix that issue or error. This is the working of testing part with chrome dev mcp tool and agent browser. 

And there are more than 550+ models are available in openrouter, everyday there will be some new models that will be released to inherit and use those models into my application, there is a method of dynamic scaling and dynamic refreshing of models daily that way I wanted to add new models automatically into pakalon. 

And also about context managment, for each model there will be some limitations to be used, during the phase 1 after the plan.md file is created there should be another file to be created called as the conetxt_management.md(for both human in loop and yolo mode) and then in that file based upon the model that is choosed the context token is split for each phase like, for phase 1 the tokens to be used is this much like that the file should contain the details, the context that should be used by each phase and each agents and sub agents should be very less, how much the context can be reduced that much should it be redueced, the tokens should be limited to each phase that during the phase 1 when the AI agent is initalised and the plan.md file is created the token limitations  and token usage is set, each phases (AI agents and sub agents ) should plan their work and create the tasks according to this token limit only, 
If the human in loop, it should ask the user for choice like either all the token available can be used for this project or let the user type the % of token to be used, that percentage should be above 65% for new project and for already exsisting project it should be above 35%. And for YOLO mode, it should automatically assign the token percenatge. 

The Application must have dynamic refreshing model fetching method to use newly models which have been released inside openrouter newly. And add them into my application, if the new model released is free to use then the application analyses that kind of model and gives the free users to use that paricular free model and if the new model released is only for pro model then the application allocates and make it to use only for the pro models only.  

And also there is another command "/undo" when typed this the codes and the files should revereted, like when some changes in the application are made and the user thinks that this change which has been made is not need then when he types as "/undo" in the chat section, what changes that is made recently should show up (code and conversation) and then there should be a follow up question as : 1. Undo  conversation, 2. undo code, 3. undo code and conversation, 4. Do nothing 
1. When clicked on undo conversation, the last recent conversation is reverted no change in codebase
2. When clicked on undo code, the last recent code is reverted and no change in conversation
3. When clicked on undo code and conversation then the code and the conversation is reverted. 
4. When clicked on Do nothing, no changes happens and no tokens are consumed. 


And When the pakalon is initalised in the phase 1 inside the user stories, there should be the sub categories based upon the user requirement if the requirement of the user is very big the user story may have sub category more than 20 , and if the user requirement is very less then the sub categaory may be in single digit also. The sub category are named from US-001, US-002, ... US-00n. Also these sub categories should contain the contents like acceptance criteria, test scenarios like that.
In simple the phase 1 is very important it should be able to generate the files which are mentioned in a very detailed and more explainatory manner so that the remaning phases and AI agents can work upon accordingly.

And to call and choose between models. the user needs to type as "/models" when this command is typed the list of models from open router shows up and the user may choose between the models. For free users only the free model and for pro users all the models should be present can choose between any models. 
And also by default the model used must be "auto"  this means that the model which have the high context window and the uses less tokens for usage is automatically choosed by the AI agent itself between the models. And if the user wantes to use specific model then the user needs to types the model name or the choose from the list of the models that are listed. 

There should be a new command called as the '/automations' when typed on this it should show the list of the automations that are created and also the option for creating a new automation workflow and the ready to use templates, when clicked on create agent, it should ask the user for name of the automations, and after the user gives the name of the automation it should ask for the prompt from the user to create the automation task, like the user may give the prompt as 'check for any PR issues from my repo<particular_repo> and update the issue in my slack channel like that, when give like that it should ask to connect the user account to slack and github and then it bridges them sets a cron job for every specific time that the user may set up and then it checks the repo for every specific time that the user have set and if found any errors it sends the message to the user's slack channel that the user have config, this is the complete working of the automations section

when the commmand '/logout' is clicked then the user's account is logged out from the web app and also from the CLI application. 

When the command '/ans' is typed and clicked then session and the AI agent keeps on running, but the working of this commmand is that when this is given the user can have a QnA session or brain storming session with the user without affecting or interupting the AI agent which is working, the appliaction and the AI agent will keep on working but when this command is typed and asked for any questions it ans them without interupting the AI agent that is working on, for exmaple if the AI agent is building the website and if the user types as '/ans what is the tech stack that is used here' then the AI agent which is already working will not stop to answer the ques, it will spawn a new sub agent just to ans this question. This command is applicable for both the pakalon-agents initialzied and non initailzed also. 

Some additional features, there are some extra commands for working, which are /phase-1, /phase-2, /phase-3, /phase-4, /phase-5, /phase-6. These commands should come into play when the .pakalon-agents are initailsed only, when the user have typed it /pakalon and initallised and created .pakalon-folder this commands can be used. 
The working of each command is that, 
/phase-1 : When this command is typed in, the application makes a detailed plan and then makes a interactive QA/ Brain stroming session between the user and pakalon and from the info that user provides and the application understands, it  fills out the all the .md files present inside the phase-1 folder. 
/phase-2 : When typed in this command it starts designing the wireframes of the application and then asks the user for permission and if there are some changes that the user wants then the AI agent should diplay the question as is this design ok or changes to be made or redesign from scratch, like that and if the user enters ok, then the request given is completed and if the user gives as not ok then it asks for changes to be made as input, and also the option for opening pakalon and then let the user to modify the wireframe accordingly, if the user clicks on penpot, then the sync.js file starts in the background and it opens penpot application via docker, then it asks displays the design and every changes that the user makes to the application are recorded and usign the sync.js file the changes are reflected in the design that is made, please make it like that. 
/phase-3 : When this command is typed in then the application starts building the application using the files from .md file and wirframe generated. 
/phase-4 : When typed in it starts testing the applications that is generated, like all the 13+ security tools are called up via docker image and then each security testing application starts working and then each application gives their confidence report. 
/phase-5 : When the command is typed up, it 1st starts pushing up to github repo, it creates the github repo and from github repo it asks the user for decision in questions like which clud platform to push the application, it gives options like aws, DO, Azure, GCD or none like that when the user selects any one, then it asks for the credentails and then push to the selected Digital platform that the user have choosed. 
/phase-6: When typed, based on the application that the user have generated, this agent should analyse the phase-1 folder and read all the files in that and also read and analyse all the files and folders that the application is built and then make a complete document on the file structure and then working everything that the application contains should be present here.
When typed name of any phase and enter it should start working. No option for sending any message after that, like take a exmaple of /web command after this command the option for sending message is present, the prompt can be " /web do a web serach on exmaple.com and give me the contents in this site" like this can be given for /web but here for this phases , it should be like "/phase-x" like this only prompt should be present and after this it should start excuting the work according to this phase that is selected. 

 There is a new command called as /connect command when typed in it should be able to connect to telegram and then if the pakalon application is kept open and kept running it is possible to connect application and telegram app, and if I send in any prompt it should be able to send that prompt to pakalon and let the work to be done. 
 The working for the 1st time is  that : After typing the command '/connect' it should display a input for entering the telegram bot token, the new bot should be created and the token should be placed in this place inside pakalon-cli application. After placing that it should connect to telegram via the webhooks.
 And for the 2nd to nth time, the working is that when the user wants to run the pakalon via telegram, he may send the command as /connect and after that the connection is made, and after that whatever the user gives prompts in the telegarm or asks the pakalon application to do tasks, if the  system is kept alive, and if pakalon is running then it may work and execute the tasks, and perform some operations in the system of the application via the telegram application, controling the system via telegram using webhooks and backend-since the backend is running all the time. The closing of this connection should be like '/connect-end' when this command is run the application's connection to the telegram should stop,
 The token which the user sends are saved in the supabase backend in the user's profile, by this way the credenatials are not exposed.

**Backend working to connect application and the website**

The backend should generate the 6 digit code when the user logs in or creates the account to the 6 didgit code is generated and displayed in the frontend and in the backend the same code is saved, like when the user enters that code in the frontend website for authentication that code which is generated and saved should match the code. 

And also the usage of the AI models, the context and tokens used, the user prompts that are send at what time they are send, the history of codes that are written. All these kinds of information which are the from the application are saved on the backend, and are displayed to the user's logged in account via the frontend webiste  of the application.

And another some features that I wanted to add into pakalon is that when the user have given the permission like 'allow always' then those permission settings should be saved by creating .pakalon/settings.local.json file in that file all the permission or rules that the user have allowed should be saved. And whenevr any session is started in that project folder where the .pakalon/settings.local.json is created then the application will look up into the file for already given permission and then start working accordingly. 

And also when the commands are working that indicate as like working, like when the application is working on some commands like just-bash, grep, search, set location like that there should be indicator that should be blinking when that command is running, and that blinking of that indicator should stop when the command execution is completed, that indicatore should be present near each command when working, please include this. 

And also there should be multi session, in detail: there should be a new command '/mutli-session' when command is run, it should show different session that is running currently (like multi tasking) and also the option to create the another new session also. At a same time in a single same terminal the option to create and run many session at a same time, How the UI should be is like, when the user have run the '/multi-session' it should be able to show the list of the session that has been created and used for that particular project, and then the when cliked on any of the session the option choose, interact in that session, the normal session/ normal UI of the cli application will be poped up and the user can interact and use the application normally, and to go back to the screen of the multi session pages, the user can again run the command, '/multi-session' command and it should take me back to the mutli session screen. And  when in the multi session screen it should indicate with loading animation for each particular session that if the session is running, and it should should show that loading animation near each session, and when the application needs any input from the user it should be able to indicate, like that particular session should blink on when the appliaction needs any input from the user when in multi screen session, and if the application have comepleted doing their work, then the loading animation which would have been working in the loading animation should stop. There should be a '+' plus button for creating the new session, this button is same as the working as running the command '/new' command. This is the complete working, UI and function of the new feature called as multi-session that I wanted to add into my application.

And also I wanted to implement the features of connecting local models via Ollama and LM studio to pakalon, I have decided to make the application to run and use in 2 ways (like now how the supabase and coolify is working) 
1. Is the selfhosted,
2. Cloud version. 
1. When the application is self hosted, the user can connect to lm studio and Ollama and then can access the local models inside that. 
How the working and frontend should be is that when the user decides to use it via locally, then the user may skip the login process, he can directly clone the pakalon app from github repo and then application must be config in a way that it should display the models only present in local models only, so there would be no token window is present for that user. And the application can run in offline. 
2. In the cloud version, now what is the working that is present that should be present, like now how the application is present the same should be present please fix on to that, there will be 2 options free and pro types of users. The same working fix on to that. 
Like the application should be like 2 kinds, in the frontend website before the authentication page there should be the options to choose, either cloud or self hosted, and then if the user chooses on selfhosted, then it should redirect to the github page where the application is present and if the user clicks on cloud then the next page authentication page, it takes on to authentication page. 


And  to implement the sandboxing, so how the application should work is that when the application that the user is about to be built in pakalon is larger then pakalon will build the application and  spin up sandbox and in that sandbox env only the 1st run and 1st testing  of the appliaction that is built should be present, and if the phase-4 confrims that there is no error, bugs, malware or vulnerability in the application  in the application then sandboxing can be stopped and the application that is built can move on to the actual env either local env or production level env that is completely based upon the user's choice.But this sandboxing should work only when the user have initailised the pakalon-agents mode only it should work, and if the user is in normal SDLC mode it should not work, and after the phase-4 review scores are more than the eligible critera only the sandboxing can stop and the code can be used on the actual env.

### **Commands :**

--add-dir <directories...>                        

  --agents                                  
  --allowedTools, --allowed-tools <tools...>       

  -c, --continue  
-r, --resume                                 
  -d, --debug [filter]                              
  --debug-file <path>                               
  --disallowedTools, --disallowed-tools <tools...>  
--defaultModel
--fallbackModel
  --fallback-model <model>                          
  --file <specs...>                               
  --fork-session                                   
  --from-pr [value]                                 
  -h, --help 
                         
  --max-budget-usd <amount>                        
  --mcp-config <configs...>                       
  --mcp-debug                                     
  --model <model>                                                                                   
  --permission-mode <mode>    - Human in loop, YOLO                      
  --plugins
  -p, --print                                       
                                          
  --replay-user-messages                            
  -r, --resume                              
  --session-id <uuid>                               
  --setting-sources <sources>                       
  --settings <file-or-json>                         
  --MCP                    
  --tools <tools...>                                
  --verbose                                         
  -v, --version    
  -plan
  -edit
  -auto-accept
  -bypass-permissions                                 

Commands:
  doctor                                           
  install
  mcp                                              
  plugin                                            
  setup-token                                       
  update

/init
/pakalon
/plugins
/models
/workflows
/directory
/agents
/web
/history
/session
/new
/resume
/resume<session_id> 
/agents
/update
/penpot
/agent
/automations
/logout
/ans
/phase-1
/phase-2
/phase-3
/phase-4
/phase-5
/phase-6
/connect
/connect-end
@- mentiones files and folders
