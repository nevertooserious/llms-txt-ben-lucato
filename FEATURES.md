Functionality: The tool should accurately generate an llms.txt file that reflects the website's structure and content. It should work for a large variety of websites.
- works for a wide variety of website types
    - e.g. javascript rendered
- handle failure (e.g. message published but site not recorded to db)
- monitoring
- admin portal ?


Code Quality: The code should be well-structured, readable, and maintainable.


Product Thinking & Creativity: We encourage candidates to go beyond the baseline requirements. Show us how you think about building a great product, not just a working solution.
- audit log


Documentation: Clear and comprehensive documentation should accompany the tool, facilitating easy setup and usage.
- examples?
<!-- - make it easy to setup update hooks? -->


Testing:
- be paranoid about functional issues in each segment of the stack
- be aware of nefarious users
- what to do with a login wall?


To be done:
- max crawl depth?
- what happens when some pages 5xx ?
- review Crawler

Questions:
- how does it scale?
- how do costs scale?
- product angle: Be ready to say who uses this, why monitoring is on by default, and why pinning and ignoring paths exist. Their business is how brands appear in AI answers, so have a view on what makes an llms.txt good, not just valid.
- what would you build with more time?
- how to handle resilience on crawl 5xx?
- talk about reconciliation safety gate - we don't want to zero an llms.txt if the site is down
- describe hack with users - they're not actually persisted in the DB. which means site info persisted in browser storage
    - api created jobs don't show up in theUI
- talk about how we could implement rate-limiting for a user, or for processing of a site
- talk about how site monitoring continues indefinitely, and what we could do about that
- talk about how we should limit re-checks to a certain minimum interval, to prevent misuse
- how to handle nefarious instructions from user? i.e. prompt injection
- actual live hosting
- "Same domain" means the site's host without a leading www., or any subdomain of it. So from www.example.com, both docs.example.com and example.com count.
- if a site already has an llms.txt we use its knowledge, but this is a bit awkward
- trusting sitemap after N successful times. conditionalRequestHeaders also for avoiding recrawling